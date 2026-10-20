import { describe, expect, it } from 'vitest'
import { parseHost, resolveSite, workspaceAllows } from './hosts'

const OTE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const resolve = (host: string) => resolveSite(host, 'https://zeespare.com', OTE)

describe('workspace host boundary', () => {
  it('binds only the explicit OTE domain to its organization id', () => {
    const site = resolve('ote.zeespare.com')
    expect(site.origin).toBe('https://ote.zeespare.com')
    expect(workspaceAllows(site.workspace, OTE)).toBe(true)
    expect(workspaceAllows(site.workspace, OTHER)).toBe(false)
  })
  it.each([
    'app.zeespare.com',
    'other.zeespare.com',
    'ote.zeespare.com.evil.com',
    'ote.zeespare.com:444',
    'ote.zeespare.com.',
    'evil.com',
  ])('rejects %s', (host) => {
    expect(resolve(host).kind).toBe('unknown')
  })
  it.each([
    'ote.zeespare.com,evil.com',
    'ote.zeespare.com@evil.com',
    'ote.zeespare.com/path',
    'ote.zeespare.com\\evil.com',
    'ote.zeespare.com?x',
    'ote.zeespare.com\n',
  ])('rejects ambiguous authority %s', (host) => expect(parseHost(host)).toBeNull())
  it('denies workspace access when binding is missing or malformed', () => {
    for (const id of ['', 'ote']) {
      expect(workspaceAllows(resolveSite('ote.zeespare.com', undefined, id).workspace, OTE)).toBe(
        false,
      )
    }
  })
  it('keeps public and legacy hosts unbound', () => {
    expect(resolve('zeespare.com').kind).toBe('public')
    expect(resolve('www.zeespare.com').kind).toBe('public')
    expect(resolve('maqdar.org').kind).toBe('shared')
    expect(workspaceAllows(null, OTHER)).toBe(true)
  })
  it('enables local aliases only in a loopback deployment and at its port', () => {
    expect(resolve('ote.localhost:3300').kind).toBe('unknown')
    expect(resolveSite('ote.localhost:3300', 'http://localhost:3300', OTE).kind).toBe('workspace')
    expect(resolveSite('ote.localhost:3301', 'http://localhost:3300', OTE).kind).toBe('unknown')
  })
})
