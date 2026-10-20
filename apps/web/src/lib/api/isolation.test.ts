import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Source scan behind the ESLint import restrictions (eslint.config.mjs): the secret-key clients
 * stay where they belong, and the /api/v1 code never touches cookies, the user session, the
 * active organization or next-intl. Imports are resolved, so relative paths count too.
 */

const SRC = resolve(__dirname, '..', '..')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(?:ts|tsx|mts|js|mjs)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [path]
      : []
  })
}

/** The file relative to src, with forward slashes. */
function srcPath(path: string): string {
  return relative(SRC, path).replaceAll('\\', '/')
}

/** Code without comments (good enough for import scanning; strings keep their text). */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g

/** Imported modules as src-relative ids without extension (`lib/supabase/api`), or the bare id. */
function imports(path: string): string[] {
  const text = code(readFileSync(path, 'utf8'))
  return [...text.matchAll(IMPORT)].map((match) => {
    const specifier = match[1] ?? ''
    let target: string | null = null
    if (specifier.startsWith('@/')) target = join(SRC, specifier.slice(2))
    else if (specifier.startsWith('.')) target = resolve(dirname(path), specifier)
    if (target === null) return specifier
    return srcPath(target)
      .replace(/\.(?:ts|tsx|js|mjs)$/, '')
      .replace(/\/index$/, '')
  })
}

const FILES = sourceFiles(SRC).map((path) => ({ path: srcPath(path), imports: imports(path) }))

function importersOf(module: string): string[] {
  return FILES.filter((file) => file.imports.includes(module)).map((file) => file.path)
}

const API_CODE = (path: string) => path.startsWith('lib/api/') || path.startsWith('app/api/v1/')

describe('secret-key clients', () => {
  it('scans the whole source tree and resolves aliased and relative imports', () => {
    expect(FILES.length).toBeGreaterThan(100)
    expect(importersOf('lib/env.server').sort()).toEqual([
      'lib/supabase/admin.ts',
      'lib/supabase/api.ts',
      'lib/supabase/auth-forwarding.ts',
    ])
    expect(importersOf('lib/api/rpc-request')).toContain('lib/supabase/api.ts')
    expect(importersOf('lib/imports/contract')).toContain('lib/api/records.ts')
  })

  it('imports src/lib/supabase/api only from the /api/v1 code', () => {
    const offenders = importersOf('lib/supabase/api').filter((path) => !API_CODE(path))
    expect(offenders).toEqual([])
  })

  it('imports src/lib/supabase/admin only from the Settings actions', () => {
    const offenders = importersOf('lib/supabase/admin').filter(
      (path) => path !== 'app/(app)/settings/actions.ts',
    )
    expect(offenders).toEqual([])
  })

  it('reads the server env only in the reviewed secret-key clients and Auth transport', () => {
    const offenders = importersOf('lib/env.server').filter(
      (path) =>
        path !== 'lib/supabase/admin.ts' &&
        path !== 'lib/supabase/api.ts' &&
        path !== 'lib/supabase/auth-forwarding.ts',
    )
    expect(offenders).toEqual([])
  })

  it('reads SUPABASE_SECRET_KEY from process.env only in env.server.ts', () => {
    const offenders = sourceFiles(SRC)
      .filter((path) => /process\.env\.SUPABASE_SECRET_KEY/.test(code(readFileSync(path, 'utf8'))))
      .map(srcPath)
    expect(offenders).toEqual(['lib/env.server.ts'])
  })

  it('keeps api.ts server-only and on raw fetch with the apikey header', () => {
    const text = readFileSync(join(SRC, 'lib/supabase/api.ts'), 'utf8')
    expect(code(text).trimStart().startsWith("import 'server-only'")).toBe(true)
    expect(imports(join(SRC, 'lib/supabase/api.ts'))).not.toContain('@supabase/supabase-js')
  })
})

describe('/api/v1 isolation', () => {
  const FORBIDDEN = [
    'next/headers',
    'next-intl',
    'next-intl/server',
    'lib/supabase/server',
    'lib/supabase/client',
    'lib/supabase/proxy',
    'lib/auth/session',
    'lib/organizations/context',
    'lib/imports/route-auth',
  ]

  it('never imports cookies, sessions, the active organization or next-intl', () => {
    const offenders = FILES.filter((file) => API_CODE(file.path)).flatMap((file) =>
      file.imports.filter((module) => FORBIDDEN.includes(module)).map((m) => `${file.path}: ${m}`),
    )
    expect(offenders).toEqual([])
  })

  it('never reads cookies', () => {
    const offenders = sourceFiles(SRC)
      .filter((path) => API_CODE(srcPath(path)))
      .filter((path) => /\bcookies\b/.test(code(readFileSync(path, 'utf8'))))
      .map(srcPath)
    expect(offenders).toEqual([])
  })
})

describe('/api/v1 handlers', () => {
  const ROUTES = [
    'app/api/v1/route.ts',
    'app/api/v1/openapi.json/route.ts',
    'app/api/v1/organization/route.ts',
    'app/api/v1/[resource]/route.ts',
    'app/api/v1/[resource]/[...rest]/route.ts',
  ]
  const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  const apiSources = () =>
    sourceFiles(SRC)
      .filter((path) => API_CODE(srcPath(path)))
      .map((path) => ({ path: srcPath(path), text: code(readFileSync(path, 'utf8')) }))

  it('scans every route file and the handler', () => {
    const scanned = apiSources().map((file) => file.path)
    expect(scanned).toEqual(
      expect.arrayContaining([...ROUTES, 'lib/api/handler.ts', 'lib/api/runtime.ts']),
    )
    const routes = scanned.filter((path) => /^app\/api\/v1\/.*route\.ts$/.test(path))
    expect(routes.sort()).toEqual([...ROUTES].sort())
  })

  it('never names the cookie session, the user client, the active organization or next-intl', () => {
    const FORBIDDEN_NAMES =
      /\b(?:cookies|getActiveContext|requireActiveOrganization|getSessionClaims|requireClaims|requireEditorRoute|createServerClient|createBrowserClient|useTranslations|getTranslations|getLocale|getMessages|getFormatter|NextIntlClientProvider)\b|\bcreateClient\s*\(|set-cookie|@supabase\/(?:ssr|supabase-js)/i
    const offenders = apiSources()
      .filter((file) => FORBIDDEN_NAMES.test(file.text))
      .map((file) => `${file.path}: ${FORBIDDEN_NAMES.exec(file.text)?.[0]}`)
    expect(offenders).toEqual([])
  })

  it('exports every method from every route, so Next.js never answers a bare 405', () => {
    for (const route of ROUTES) {
      const text = code(readFileSync(join(SRC, route), 'utf8'))
      const exported = [
        ...text.matchAll(/^export const (GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\b/gm),
      ]
        .map((match) => match[1])
        .sort()
      expect(exported, route).toEqual([...METHODS].sort())
      expect(text, route).toMatch(/^export const dynamic = 'force-dynamic'$/m)
    }
  })

  it('routes call the handler with the runtime dependencies only', () => {
    for (const route of ROUTES) {
      const modules = imports(join(SRC, route))
      expect(modules, route).toContain('lib/api/handler')
      expect(modules, route).toContain('lib/api/runtime')
      expect(modules, route).not.toContain('lib/supabase/api')
    }
  })
})
