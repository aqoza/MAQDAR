import { defineConfig } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import base from './playwright.config'
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'
const port = Number(new URL(baseURL).port) || 3000
const server = Array.isArray(base.webServer) ? base.webServer[0] : base.webServer
export default defineConfig({
  ...base,
  testMatch: [
    'policy-explainer.spec.ts',
    'forecast-explainer.spec.ts',
    'replenishment-explainer.spec.ts',
  ],
  outputDir: 'test-results/policy-explainer',
  testIgnore: [],
  expect: { timeout: 15_000 },
  use: { ...base.use, actionTimeout: 15_000 },
  webServer: {
    ...server,
    command: process.env.CI ? `pnpm exec next start -p ${port}` : `pnpm exec next dev -p ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...server?.env,
      NEXT_PUBLIC_SITE_URL: baseURL,
      ANTHROPIC_API_KEY: 'test-only-claude-key-no-external-access',
      ZEESPARE_CLAUDE_MODEL: 'claude-sonnet-5-5',
      ZEESPARE_POLICY_TEST: 'true',
      NODE_OPTIONS: `--import=${pathToFileURL(path.join(__dirname, 'e2e/helpers/policy-provider.mjs')).href}`,
    },
  },
})
