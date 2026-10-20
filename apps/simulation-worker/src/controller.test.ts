import assert from 'node:assert/strict'
import { test } from 'node:test'
import { tick, type RuntimeConfig, type ContainerHandle } from './controller.ts'

const configured: RuntimeConfig = {
  ENABLED: 'true',
  MODE: 'probe',
  MAQDAR_EXPECTED_ORGANIZATION: '00000000-0000-4000-8000-000000000001',
  MAQDAR_WORKER_DSN: 'local-test-dsn',
  MAQDAR_DATABASE_CA: 'local-test-ca',
}

function fake(running = false) {
  const calls: string[] = []
  const container: ContainerHandle = {
    running,
    images: { base: 'test-image' },
    start() {
      calls.push('start')
    },
    signal() {
      calls.push('stop')
    },
    async setInactivityTimeout() {
      calls.push('timeout')
    },
    getTcpPort() {
      return {
        async fetch() {
          calls.push('health')
          return new Response('{}')
        },
      }
    },
  }
  return { container, calls }
}

test('paused deployment never starts a process', async () => {
  const { container, calls } = fake()
  await tick(container, { ...configured, ENABLED: 'false' })
  assert.deepEqual(calls, [])
})

test('pause requests graceful termination of only this instance', async () => {
  const { container, calls } = fake(true)
  await tick(container, { ...configured, ENABLED: 'false' })
  assert.deepEqual(calls, ['stop'])
})

test('missing configuration does not start a process', async () => {
  const { container, calls } = fake()
  await assert.rejects(() => tick(container, { ...configured, MAQDAR_DATABASE_CA: '' }))
  assert.deepEqual(calls, [])
})

test('healthy running process is probed without another start', async () => {
  const { container, calls } = fake(true)
  await tick(container, configured)
  assert.deepEqual(calls, ['timeout', 'health'])
})

test('start config uses scoped entry point environment, followed by readiness', async () => {
  const { container, calls } = fake()
  await tick(container, configured)
  assert.deepEqual(calls, ['start', 'timeout', 'health'])
})

test('unhealthy process is stopped without logging its response', async () => {
  const { container, calls } = fake(true)
  container.getTcpPort = () => ({
    async fetch() {
      return new Response('private payload', { status: 503 })
    },
  })
  await assert.rejects(() => tick(container, configured), {
    message: 'Simulation container health failed (HTTP 503)',
  })
  assert.deepEqual(calls, ['timeout', 'stop'])
})

test('health transport failures expose only a fixed diagnostic category', async () => {
  const { container } = fake(true)
  container.getTcpPort = () => ({
    async fetch() {
      throw new TypeError('private provider payload with a credential')
    },
  })
  await assert.rejects(() => tick(container, configured), {
    message: 'Simulation container health failed (transport TypeError)',
  })
})

test('cold startup may outlast twenty connection-refused checks without being stopped', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { container, calls } = fake()
  let probes = 0
  container.getTcpPort = () => ({
    async fetch() {
      if (++probes < 25) throw new Error('connection refused')
      return new Response('{}')
    },
  })
  const check = tick(container, configured)
  void check.catch(() => {})
  for (let attempt = 0; attempt < 30; attempt++) {
    t.mock.timers.tick(500)
    await new Promise((resolve) => setImmediate(resolve))
  }
  await check
  assert.equal(probes, 25)
  assert.ok(!calls.includes('stop'))
})

test('known native port errors use fixed categories without provider text', async () => {
  for (const [message, category] of [
    ['There is no container instance that can be provided to this Durable Object, try again later', 'instance unavailable'],
    ['The container is not running', 'instance not running'],
    ['connect(): Connection refused: container port not found', 'connection refused'],
    ['HTTP protocol error: private provider details', 'HTTP protocol'],
    ['Network connection lost.', 'network lost'],
  ]) {
    const { container } = fake(true)
    container.getTcpPort = () => ({ async fetch() { throw new Error(message) } })
    await assert.rejects(() => tick(container, configured), {
      message: `Simulation container health failed (${category})`,
    })
  }
})
