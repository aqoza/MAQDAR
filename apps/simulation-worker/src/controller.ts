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
  const port = container.getTcpPort(8080)
  const attempts = starting ? 20 : 1
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await port.fetch('http://container/health', {
        signal: AbortSignal.timeout(1000),
      })
      await response.body?.cancel()
      if (response.ok) return
    } catch {
      // Startup can precede the health listener. Never log provider errors/secrets.
    }
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (container.running) container.signal(15)
  throw new Error('Simulation container health failed')
}
