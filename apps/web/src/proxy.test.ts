import { AsyncLocalStorage } from 'node:async_hooks'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_V1_PREFIX, isApiV1Path } from './lib/api/path'
import { API_BASE_PATH } from './lib/api/resources'

// next/server reads AsyncLocalStorage from the global scope, which Next.js sets up at runtime.
;(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= AsyncLocalStorage

const { unstable_doesMiddlewareMatch } = await import('next/experimental/testing/server')

/**
 * The proxy refreshes the cookie session and guards app routes; the REST API (/api/v1) must stay
 * outside it (API keys only, no cookies, no redirect to /login). proxy.ts cannot be imported here
 * (it pulls in the `@/` alias), so the matcher literal is read from the source: Next.js parses it
 * statically at build time in the same way.
 */
const SOURCE = readFileSync(join(__dirname, 'proxy.ts'), 'utf8')

function matcherFromSource(): string[] {
  // Without comments: they may hold apostrophes.
  const block = (/matcher:\s*\[([\s\S]*?)\]\s*,?\s*\}/.exec(SOURCE)?.[1] ?? '').replace(
    /\/\/.*$/gm,
    '',
  )
  const literals = [...block.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((match) => match[1] ?? '')
  // The literals hold no escapes other than `\\` (a JavaScript string's backslash).
  return literals.map((literal) => literal.replace(/\\(.)/g, '$1'))
}

const MATCHER = matcherFromSource()

function matches(url: string): boolean {
  return unstable_doesMiddlewareMatch({ config: { matcher: MATCHER }, url })
}

describe('proxy matcher', () => {
  it('is the one expected pattern', () => {
    expect(MATCHER).toEqual([
      '/((?!api/v1(?:/|$)|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
    ])
  })

  it.each([
    '/api/v1',
    '/api/v1/',
    '/api/v1/items',
    '/api/v1/items:upsert',
    '/api/v1/items%3Aupsert',
    '/api/v1/demand-history:upsert',
    '/api/v1/openapi.json',
    '/api/v1/organization',
    '/api/v1/items/x/y',
    '/api/v1/demand-history?from=2026-01-01&to=2026-12-31',
  ])('leaves the REST API path %s alone', (url) => {
    expect(matches(url)).toBe(false)
  })

  it.each([
    '/api/v1x',
    '/api/v10/x',
    '/api/v2/items',
    '/api/imports',
    '/api/imports/abc',
    '/api/lookup/items?q=a',
    '/dashboard',
    '/settings',
    '/login',
    '/imports?source=api',
    '/',
    // The asset exclusion needs a real dot before the extension.
    '/reports/svg',
    '/master-data/items/ico',
  ])('runs for %s', (url) => {
    expect(matches(url)).toBe(true)
  })

  it.each(['/_next/static/chunks/main.js', '/_next/image?url=x', '/favicon.ico', '/logo.svg'])(
    'still skips the static asset %s',
    (url) => {
      expect(matches(url)).toBe(false)
    },
  )
})

describe('proxy backstop', () => {
  it('recognizes /api/v1 and everything below it, nothing else', () => {
    expect(API_V1_PREFIX).toBe(API_BASE_PATH)
    for (const path of ['/api/v1', '/api/v1/', '/api/v1/items', '/api/v1/items:upsert']) {
      expect(isApiV1Path(path)).toBe(true)
    }
    for (const path of ['/api/v1x', '/api/v10/x', '/api/v', '/api', '/api/imports', '/v1/items']) {
      expect(isApiV1Path(path)).toBe(false)
    }
  })

  it('agrees with the matcher', () => {
    for (const path of ['/api/v1', '/api/v1/items', '/api/v1x', '/api/v10/x', '/dashboard']) {
      expect(isApiV1Path(path)).toBe(!matches(path))
    }
  })

  it('returns early for /api/v1 before the session is touched', () => {
    const body = /export async function proxy\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(SOURCE)?.[1] ?? ''
    const early = body.indexOf(
      'if (isApiV1Path(request.nextUrl.pathname)) return NextResponse.next()',
    )
    const session = body.indexOf('updateSession(request)')
    expect(early).toBeGreaterThanOrEqual(0)
    expect(session).toBeGreaterThan(early)
  })
})
