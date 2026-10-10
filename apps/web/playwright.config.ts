import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// The helpers seed users through the admin API and read Mailpit, so they need the local stack's
// variables. CI exports them to the job environment (scripts/write-env.mjs --github-env); locally
// they come from apps/web/.env.local, written by `pnpm db:env`. Existing variables win.
if (!process.env.SUPABASE_SECRET_KEY) {
  try {
    process.loadEnvFile(path.join(__dirname, '.env.local'))
  } catch {
    // No .env.local yet: the helpers fail with a hint naming the missing variable.
  }
}

const port = 3000
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`
const isCI = Boolean(process.env.CI)

export default defineConfig({
  testDir: './e2e',
  // The specs share one local stack and one Mailpit inbox; they run one at a time, in file order.
  fullyParallel: false,
  workers: 1,
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
