import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './browser-tests',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm exec vite --host 127.0.0.1 --port 3100 --strictPort',
    url: 'http://127.0.0.1:3100/e2e/fixtures/forecast-tabs/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
