import { DurableObject } from 'cloudflare:workers'
import { tick, type RuntimeConfig } from './controller'

interface Env extends RuntimeConfig {
  ACME_SIMULATION: DurableObjectNamespace<AcmeSimulationContainer>
}

export class AcmeSimulationContainer extends DurableObject<Env> {
  private pending: Promise<void> | undefined

  check(): Promise<void> {
    // Every trigger uses the same named DO and shares startup/health work.
    this.pending ??= this.run().finally(() => {
      this.pending = undefined
    })
    return this.pending
  }

  private async run(): Promise<void> {
    if (!this.ctx.container) throw new Error('Simulation container binding is missing')
    try {
      await tick(this.ctx.container, this.env)
    } catch (error) {
      // Only tick's fixed diagnostic categories may be logged, never provider text.
      if (
        error instanceof Error &&
        /^Simulation container health failed \((?:HTTP [1-5][0-9]{2}|transport TypeError|transport unavailable|unavailable|instance unavailable|instance not running|connection refused|HTTP protocol|network lost)\)$/.test(
          error.message,
        )
      )
        console.error(error.message)
      throw new Error('Simulation supervisor check failed')
    }
  }
}

export default {
  fetch(): Response {
    // No public status, start, stop, SQL, run-ID or tenant selection endpoint.
    return new Response('Not found', { status: 404 })
  },
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    try {
      await env.ACME_SIMULATION.getByName('acme-simulations-v1').check()
      console.log('Simulation supervisor check completed')
    } catch {
      console.error('Simulation supervisor check failed')
      throw new Error('Simulation supervisor check failed')
    }
  },
} satisfies ExportedHandler<Env>
