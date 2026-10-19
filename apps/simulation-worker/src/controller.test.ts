import assert from 'node:assert/strict'
import { test } from 'node:test'
import { tick, type RuntimeConfig, type ContainerHandle } from './controller.ts'

const configured: RuntimeConfig = {
  ENABLED: 'true',
  MAQDAR_EXPECTED_ORGANIZATION: '00000000-0000-4000-8000-000000000001',
  MAQDAR_WORKER_DSN: 'local-test-dsn',
  MAQDAR_DATABASE_CA: 'local-test-ca',
}

function fake(running = false) {
  const calls: string[] = []
  const container: ContainerHandle = {
    running,
    images: { base: 'test-image' },
    start() { calls.push('start') },
    signal() { calls.push('stop') },
    async setInactivityTimeout() { calls.push('timeout') },
    getTcpPort() {
      return { async fetch() { calls.push('health'); return new Response('{}') } }
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
  container.getTcpPort = () => ({ async fetch() { return new Response('private payload', { status: 503 }) } })
  await assert.rejects(() => tick(container, configured), { message: 'Simulation container health failed' })
  assert.deepEqual(calls, ['timeout', 'stop'])
})
