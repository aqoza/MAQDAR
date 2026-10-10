import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    // Cloudflare: OpenNext build output and wrangler state.
    '.open-next/**',
    '.wrangler/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'coverage/**',
    '.vitest/**',
    'playwright-report/**',
    'test-results/**',
  ]),
])
