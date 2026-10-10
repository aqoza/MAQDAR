import { describe, expect, it } from 'vitest'
import { safeDestination, safeNextPath } from './redirects'

const ORIGIN = 'http://localhost:3000'

describe('safeNextPath', () => {
  it('keeps same-origin paths', () => {
    expect(safeNextPath('/items?page=2')).toBe('/items?page=2')
  })

  it('falls back to the dashboard for anything else', () => {
    expect(safeNextPath(null)).toBe('/dashboard')
    expect(safeNextPath('')).toBe('/dashboard')
    expect(safeNextPath('https://evil.example')).toBe('/dashboard')
    expect(safeNextPath('//evil.example')).toBe('/dashboard')
    expect(safeNextPath('/\\evil.example')).toBe('/dashboard')
  })

  it('rejects control characters that browsers strip before resolving the URL', () => {
    expect(safeNextPath('/\t/evil.example')).toBe('/dashboard')
    expect(safeNextPath('/\n/evil.example')).toBe('/dashboard')
    expect(safeNextPath('/\r\n/evil.example/login')).toBe('/dashboard')
    expect(safeNextPath('/\t\\evil.example')).toBe('/dashboard')
    expect(safeNextPath('/\u0000/evil.example')).toBe('/dashboard')
  })

  it('normalises dot segments without leaving the site', () => {
    expect(safeNextPath('/settings/../dashboard')).toBe('/dashboard')
    expect(safeNextPath('/a/..//evil.example')).toBe('/dashboard')
  })
})

describe('safeDestination', () => {
  it('keeps relative paths under the same rules as safeNextPath', () => {
    expect(safeDestination('/items?page=2', ORIGIN)).toBe('/items?page=2')
    expect(safeDestination('//evil.example', ORIGIN)).toBe('/dashboard')
    expect(safeDestination('/\\evil.example', ORIGIN)).toBe('/dashboard')
    expect(safeDestination('/\t/evil.example', ORIGIN)).toBe('/dashboard')
  })

  it('does not let a stripped tab or newline in an absolute URL escape the site', () => {
    expect(safeDestination('http://localhost:3000/\t/evil.example', ORIGIN)).toBe('/dashboard')
    expect(safeDestination('http://localhost:3000/\n/evil.example', ORIGIN)).toBe('/dashboard')
  })

  it('reduces absolute URLs on the site origin to path and query', () => {
    expect(safeDestination('http://localhost:3000/invitations?from=mail', ORIGIN)).toBe(
      '/invitations?from=mail',
    )
    expect(safeDestination('http://localhost:3000', ORIGIN)).toBe('/')
    expect(safeDestination('HTTP://LOCALHOST:3000/settings#members', ORIGIN)).toBe('/settings')
  })

  it('accepts an origin written with a trailing slash or a path', () => {
    expect(
      safeDestination('https://app.maqdar.example/dashboard', 'https://app.maqdar.example/'),
    ).toBe('/dashboard')
    expect(
      safeDestination('https://app.maqdar.example/dashboard', 'https://app.maqdar.example/login'),
    ).toBe('/dashboard')
  })

  it('falls back to the dashboard for other origins and unparsable values', () => {
    expect(safeDestination(null, ORIGIN)).toBe('/dashboard')
    expect(safeDestination(undefined, ORIGIN)).toBe('/dashboard')
    expect(safeDestination('', ORIGIN)).toBe('/dashboard')
    expect(safeDestination('https://evil.example/dashboard', ORIGIN)).toBe('/dashboard')
    expect(safeDestination('http://localhost:3001/dashboard', ORIGIN)).toBe('/dashboard')
    expect(safeDestination('https://localhost:3000/dashboard', ORIGIN)).toBe('/dashboard')
    expect(safeDestination('http://localhost:3000.evil.example/x', ORIGIN)).toBe('/dashboard')
    expect(safeDestination('http://evil.example/http://localhost:3000', ORIGIN)).toBe('/dashboard')
    expect(safeDestination('javascript:alert(1)', ORIGIN)).toBe('/dashboard')
    expect(safeDestination('mailto:someone@example.com', ORIGIN)).toBe('/dashboard')
    expect(safeDestination('dashboard', ORIGIN)).toBe('/dashboard')
    expect(safeDestination('http://localhost:3000/items', 'not a url')).toBe('/dashboard')
    expect(safeDestination('http://localhost:3000/items', '')).toBe('/dashboard')
  })

  it('never returns a protocol-relative path extracted from an absolute URL', () => {
    expect(safeDestination('http://localhost:3000//evil.example', ORIGIN)).toBe('/dashboard')
    expect(safeDestination('http://localhost:3000/\\evil.example', ORIGIN)).toBe('/dashboard')
  })
})
