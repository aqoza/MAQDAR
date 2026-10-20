import { describe, expect, it } from 'vitest'
import { isWorkspaceSlug, parseHost, resolveSite, workspaceAllows } from './hosts'

const OTE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ACME = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const resolve = (host: string) => resolveSite(host, 'https://zeespare.com', OTE, ACME)

describe('workspace host boundary', () => {
  it('binds ACME to its existing organization independently of OTE', () => {
    const site = resolve('acme.zeespare.com')
    expect(site).toEqual({
      kind: 'workspace',
      origin: 'https://acme.zeespare.com',
      workspace: { slug: 'acme', name: 'ACME', organizationId: ACME },
    })
    expect(workspaceAllows(site.workspace, ACME)).toBe(true)
    expect(workspaceAllows(site.workspace, OTE)).toBe(false)
    expect(workspaceAllows(resolve('ote.zeespare.com').workspace, ACME)).toBe(false)
  })
  it.each(['', 'acme'])('fails closed when the ACME binding is invalid: %s', (id) => {
    const site = resolveSite('acme.zeespare.com', undefined, OTE, id)
    expect(site.kind).toBe('workspace')
    expect(workspaceAllows(site.workspace, ACME)).toBe(false)
    expect(workspaceAllows(site.workspace, OTE)).toBe(false)
    expect(resolveSite('ote.zeespare.com', undefined, OTE, id).workspace?.organizationId).toBe(OTE)
    expect(resolveSite('acme.zeespare.com', undefined, id, ACME).workspace?.organizationId).toBe(
      ACME,
    )
  })
  it('limits the finder to provisioned slugs including rejecting prototype keys', () => {
    expect(isWorkspaceSlug('acme')).toBe(true)
    expect(isWorkspaceSlug('ote')).toBe(true)
    for (const slug of [
      'constructor',
      '__proto__',
      'toString',
      'other',
      'https://evil.com',
      'acme.evil.com',
    ]) {
      expect(isWorkspaceSlug(slug)).toBe(false)
    }
  })
  it('enables ACME loopback aliases only at the configured port', () => {
    expect(resolve('acme.localhost:3300').kind).toBe('unknown')
    expect(
      resolveSite('acme.localhost:3300', 'http://localhost:3300', OTE, ACME).workspace
        ?.organizationId,
    ).toBe(ACME)
    expect(resolveSite('acme.localhost:3301', 'http://localhost:3300', OTE, ACME).kind).toBe(
      'unknown',
    )
  })
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
    'acme.zeespare.com.evil.com',
    'acme.zeespare.com:444',
    'acme.zeespare.com.',
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
