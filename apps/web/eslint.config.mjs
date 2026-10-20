import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

// The Supabase secret key reaches three reviewed modules: src/lib/supabase/admin.ts (auth.admin calls
// from the Settings actions) and src/lib/supabase/api.ts (the api_* RPCs of the /api/v1
// handlers). The two restrictions use different rule names so their allow-lists do not override
// each other. auth-forwarding.ts adds the key only to pinned ordinary Auth endpoints;
// src/lib/api/isolation.test.ts scans the sources as a backstop.
const API_CLIENT = {
  group: ['@/lib/supabase/api', '**/lib/supabase/api', '**/supabase/api'],
  message:
    'The secret-key RPC client is only for the /api/v1 handlers (src/lib/api/**, src/app/api/v1/**).',
}
const ADMIN_CLIENT = {
  group: ['@/lib/supabase/admin', '**/lib/supabase/admin', '**/supabase/admin'],
  message: 'The service-role admin client is only for auth.admin calls in the Settings actions.',
}
const SERVER_ENV = {
  group: ['@/lib/env.server', '**/lib/env.server'],
  message: 'The secret key is confined to the reviewed admin, API and Auth-forwarding modules.',
}
const TS_FILES = ['**/*.{ts,tsx,mts,cts}']

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    name: 'maqdar/api-client',
    files: ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'],
    ignores: ['src/lib/api/**', 'src/app/api/v1/**', 'src/lib/supabase/api.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [API_CLIENT] }] },
  },
  {
    name: 'maqdar/secret-key',
    files: TS_FILES,
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: [ADMIN_CLIENT, SERVER_ENV] },
      ],
    },
  },
  {
    name: 'maqdar/secret-key/settings-actions',
    files: ['src/app/(app)/settings/actions.ts'],
    rules: { '@typescript-eslint/no-restricted-imports': ['error', { patterns: [SERVER_ENV] }] },
  },
  {
    name: 'maqdar/secret-key/clients',
    files: [
      'src/lib/supabase/admin.ts',
      'src/lib/supabase/api.ts',
      'src/lib/supabase/auth-forwarding.ts',
    ],
    rules: { '@typescript-eslint/no-restricted-imports': ['error', { patterns: [ADMIN_CLIENT] }] },
  },
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
