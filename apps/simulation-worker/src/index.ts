import { DurableObject } from 'cloudflare:workers'
import { tick, ContainerMonitor, type RuntimeConfig } from './controller'

interface Env extends RuntimeConfig {
  ACME_SIMULATION: DurableObjectNamespace<AcmeSimulationContainer>
}

export class AcmeSimulationContainer extends DurableObject<Env> {
  private pending: Promise<void> | undefined
  private readonly monitor = new ContainerMonitor((pending) => this.ctx.waitUntil(pending))

  check(config: RuntimeConfig): Promise<void> {
    // Every trigger uses the same named DO and shares startup/health work.
    this.pending ??= this.run(config).finally(() => {
      this.pending = undefined
    })
    return this.pending
  }

  private async run(config: RuntimeConfig): Promise<void> {
    if (!this.ctx.container) throw new Error('Simulation container binding is missing')
    try {
      await tick(this.ctx.container, config, this.monitor)
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
      // A resident DO can retain its prior deployment's environment. Forward
      // the current cron configuration so pause does not depend on eviction.
      await env.ACME_SIMULATION.getByName('acme-simulations-v1').check({
        ENABLED: env.ENABLED,
        MODE: env.MODE,
        MAQDAR_EXPECTED_ORGANIZATION: env.MAQDAR_EXPECTED_ORGANIZATION,
        MAQDAR_WORKER_DSN: env.MAQDAR_WORKER_DSN,
        MAQDAR_DATABASE_CA: env.MAQDAR_DATABASE_CA,
      })
      console.log('Simulation supervisor check completed')
    } catch {
      console.error('Simulation supervisor check failed')
      throw new Error('Simulation supervisor check failed')
    }
  },
} satisfies ExportedHandler<Env>
