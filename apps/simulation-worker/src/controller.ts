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
  setInactivityTimeout(ms: number): Promise<void>
  getTcpPort(port: number): { fetch(url: string, init?: RequestInit): Promise<Response> }
  exec?(
    command: string[],
    options: {
      stdout: 'ignore'
      stderr: 'ignore'
      env: Record<string, string>
      signal: AbortSignal
    },
  ): Promise<{ exitCode: Promise<number> }>
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

export async function tick(container: ContainerHandle, config: RuntimeConfig): Promise<void> {
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
  // Cron refreshes the watchdog each minute; absent cron stops only this instance.
  await container.setInactivityTimeout(180_000)
  // Cold image/network startup needs a bounded grace period. Running instances
  // still fail their first unhealthy probe immediately.
  const attempts = starting ? 60 : 1
  const deadline = Date.now() + 90_000
  let failure = 'unavailable'
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await container.getTcpPort(8080).fetch('http://container/health', {
        signal: AbortSignal.timeout(1000),
      })
      await response.body?.cancel()
      if (response.ok) return
      failure = `HTTP ${response.status}`
    } catch (error) {
      // Startup can precede the health listener. Never log provider errors/secrets.
      failure = transportFailure(error)
      if (container.exec) {
        try {
          const process = await container.exec(
            [
              '/app/engine/.venv/bin/python',
              '-c',
              "import urllib.request; r=urllib.request.urlopen('http://127.0.0.1:8080/health',timeout=1); raise SystemExit(0 if r.status==200 else 1)",
            ],
            { stdout: 'ignore', stderr: 'ignore', env: {}, signal: AbortSignal.timeout(3000) },
          )
          if ((await process.exitCode) === 0) return
        } catch {
          // A fixed local command receives no runtime secrets and emits no output.
        }
      }
    }
    if (Date.now() >= deadline) break
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (container.running) container.signal(15)
  throw new Error(`Simulation container health failed (${failure})`)
}
