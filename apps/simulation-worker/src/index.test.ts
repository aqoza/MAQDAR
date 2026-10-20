import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'

// The native base has no logic under test. Exercise the real cron-to-DO path
// with different deployment environments, without a Cloudflare account.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers') {
      return { shortCircuit: true, url: 'data:text/javascript,export class DurableObject { constructor(ctx,env) { this.ctx=ctx; this.env=env } }' }
    }
    if (specifier === './controller') return nextResolve('./controller.ts', context)
    return nextResolve(specifier, context)
  },
})
const { default: worker, AcmeSimulationContainer } = await import('./index.ts')
hooks.deregister()

test('current paused cron stops a resident DO with its prior enabled environment', async () => {
  const calls: string[] = []
  const oldEnvironment = { ENABLED: 'true', MODE: 'probe' }
  const container = {
    running: true,
    signal(signal: number) { calls.push(`signal ${signal}`) },
  }
  const resident = new AcmeSimulationContainer({ container } as never, oldEnvironment as never)
  const currentEnvironment = {
    ...oldEnvironment,
    ENABLED: 'false',
    ACME_SIMULATION: {
      getByName(name: string) {
        assert.equal(name, 'acme-simulations-v1')
        return resident
      },
    },
  }
  await worker.scheduled({} as never, currentEnvironment as never)
  assert.deepEqual(calls, ['signal 15'])
  assert.equal(worker.fetch().status, 404)
})
