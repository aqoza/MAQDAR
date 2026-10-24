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

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'
const port = Number(new URL(baseURL).port) || 3000
const isCI = Boolean(process.env.CI)

export default defineConfig({
  testDir: './e2e',
  // Runs separately with a loopback-only mocked provider and no live Claude calls.
  testIgnore: [
    '**/policy-explainer.spec.ts',
    '**/forecast-explainer.spec.ts',
    '**/replenishment-explainer.spec.ts',
  ],
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
    env: {
      NEXT_PUBLIC_SITE_URL: baseURL,
      OTE_ORGANIZATION_ID: '00000000-0000-4000-8000-000000000095',
      ACME_ORGANIZATION_ID: '00000000-0000-4000-8000-000000000096',
    },
    // CI builds first and serves the production bundle; locally the dev server is reused if running.
    command: isCI ? `pnpm exec next start -p ${port}` : `pnpm exec next dev -p ${port}`,
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
})
