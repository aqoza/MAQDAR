export interface RuntimeConfig {
  ENABLED: string
  MODE: string
  MAQDAR_EXPECTED_ORGANIZATION: string
  MAQDAR_WORKER_DSN: string
  MAQDAR_DATABASE_CA: string
}

// Narrow structural boundary makes the lifecycle executable in node tests.
export interface ContainerHandle {
  readonly running: boolean
  readonly images: Record<string, string>
  start(options: {
    image: string
    instance: 'basic'
    enableInternet: boolean
    env: Record<string, string>
  }): void
  signal(signal: number): void
  monitor(): Promise<void>
  setInactivityTimeout(ms: number): Promise<void>
  getTcpPort(port: number): { fetch(url: string, init?: RequestInit): Promise<Response> }
}

// Recreated with the Durable Object: monitors do not survive an isolate restart.
export class ContainerMonitor {
  private pending: Promise<void> | undefined
  private readonly waitUntil: (pending: Promise<void>) => void
  private readonly report: (message: string) => void

  constructor(
    waitUntil: (pending: Promise<void>) => void,
    report: (message: string) => void = console.log,
  ) {
    this.waitUntil = waitUntil
    this.report = report
  }

  observe(container: ContainerHandle): void {
    if (this.pending) return
    // Observe immediately after start, before yielding to readiness checks.
    // Native failures may be synchronous; never log their provider text.
    let observed: Promise<void>
    try {
      observed = container.monitor()
    } catch (error) {
      observed = Promise.reject(error)
    }
    this.pending = observed
      .then(
        () => this.report('Simulation container exited cleanly'),
        (error: unknown) => {
          const code = error instanceof Error && 'exitCode' in error ? error.exitCode : undefined
          this.report(
            typeof code === 'number' && Number.isInteger(code) && code >= 0 && code <= 255
              ? `Simulation container exited (code ${code})`
              : 'Simulation container lifecycle failed',
          )
        },
      )
      .finally(() => {
        this.pending = undefined
      })
    this.waitUntil(this.pending)
  }
}

function transportFailure(error: unknown): string {
  if (error instanceof TypeError) return 'transport TypeError'
  if (!(error instanceof Error)) return 'transport unavailable'
  const message = error.message.toLowerCase()
  for (const [fragment, category] of [
    ['no container instance', 'instance unavailable'],
    ['container is not running', 'instance not running'],
    ['connection refused', 'connection refused'],
    ['http', 'HTTP protocol'],
    ['network connection lost', 'network lost'],
  ]) {
    if (message.includes(fragment)) return category
  }
  return 'transport unavailable'
}

export async function tick(
  container: ContainerHandle,
  config: RuntimeConfig,
  monitor = new ContainerMonitor(() => {}),
): Promise<void> {
  if (config.ENABLED !== 'true') {
    if (container.running) container.signal(15)
    return
  }
  if (
    !config.MAQDAR_WORKER_DSN ||
    !config.MAQDAR_DATABASE_CA ||
    !['probe', 'consume'].includes(config.MODE) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      config.MAQDAR_EXPECTED_ORGANIZATION,
    )
  ) {
    throw new Error('Simulation container configuration is incomplete')
  }
  const starting = !container.running
  if (starting) {
    container.start({
      image: container.images.base,
      instance: 'basic',
      enableInternet: true,
      env: {
        MAQDAR_WORKER_DSN: config.MAQDAR_WORKER_DSN,
        MAQDAR_DATABASE_CA: config.MAQDAR_DATABASE_CA,
        MAQDAR_EXPECTED_ORGANIZATION: config.MAQDAR_EXPECTED_ORGANIZATION,
        MAQDAR_WORKER_MODE: config.MODE,
      },
    })
  }
  monitor.observe(container)
  // Cron refreshes the watchdog each minute; absent cron stops only this instance.
  await container.setInactivityTimeout(180_000)
  const port = container.getTcpPort(8080)
  // Cold image/network startup needs a bounded grace period. Running instances
  // still fail their first unhealthy probe immediately.
  const attempts = starting ? 60 : 1
  let failure = 'unavailable'
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await port.fetch('http://container/health', {
        signal: AbortSignal.timeout(1000),
      })
      await response.body?.cancel()
      if (response.ok) return
      failure = `HTTP ${response.status}`
    } catch (error) {
      // Startup can precede the health listener. Never log provider errors/secrets.
      failure = transportFailure(error)
    }
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (container.running) container.signal(15)
  throw new Error(`Simulation container health failed (${failure})`)
}
