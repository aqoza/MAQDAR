import { defineConfig, devices } from '@playwright/test'

const port = 3000
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`
const isCI = Boolean(process.env.CI)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // CI builds first and serves the production bundle; locally the dev server is reused if running.
    command: isCI ? `pnpm exec next start -p ${port}` : `pnpm exec next dev -p ${port}`,
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
})
