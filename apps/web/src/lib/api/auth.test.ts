import { describe, expect, it } from 'vitest'
import { ENTITY_NAMES } from '../imports/contract'
import {
  API_SCOPES,
  SCOPE_DESCRIPTIONS,
  credentialProblem,
  isApiScope,
  keyScopes,
  readCredential,
  resolvePendingProblem,
  scopeFor,
} from './auth'
import { toProblem } from './problem'

const REQUEST_ID = '3d6c3f3e-8f0a-4f43-9d55-1f0c2b7a9e10'
const TOKEN = 'maqdar_sk_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefg27zRqD'

function headers(authorization?: string): Headers {
  const result = new Headers()
  if (authorization !== undefined) result.set('authorization', authorization)
  return result
}

describe('scopes', () => {
  it('has explicit scopes with descriptions', () => {
    expect(API_SCOPES).toEqual([
      'master_data:read',
      'master_data:write',
      'transactions:read',
      'transactions:write',
      'purchase_handoffs:read',
      'purchase_handoffs:acknowledge',
      'transfer_handoffs:read',
      'transfer_handoffs:acknowledge',
      'event_purchase_handoffs:read',
    ])
    expect(Object.keys(SCOPE_DESCRIPTIONS)).toEqual([...API_SCOPES])
    expect(isApiScope('master_data:read')).toBe(true)
    expect(isApiScope('read')).toBe(false)
  })

  it('needs transactions scopes for transaction feeds and master_data scopes otherwise', () => {
    for (const entity of ENTITY_NAMES) {
      const family = ['demand_history', 'stock_snapshots', 'open_orders', 'receipts'].includes(
        entity,
      )
        ? 'transactions'
        : 'master_data'
      expect(scopeFor(entity, 'read')).toBe(`${family}:read`)
      expect(scopeFor(entity, 'write')).toBe(`${family}:write`)
    }
  })
})

describe('readCredential', () => {
  it('accepts a well-formed key with a matching checksum', () => {
    expect(readCredential(headers(`Bearer ${TOKEN}`))).toEqual({ ok: true, token: TOKEN })
  })

  it('answers unauthorized without credentials and invalid_token for bad ones', () => {
    expect(readCredential(headers())).toEqual({ ok: false, code: 'unauthorized' })
    expect(readCredential(headers('Basic abc'))).toEqual({ ok: false, code: 'unauthorized' })
    expect(readCredential(headers('Bearer'))).toEqual({ ok: false, code: 'invalid_token' })
    expect(readCredential(headers('Bearer not-a-key'))).toEqual({
      ok: false,
      code: 'invalid_token',
    })
    const typo = `${TOKEN.slice(0, 20)}x${TOKEN.slice(21)}`
    expect(readCredential(headers(`Bearer ${typo}`))).toEqual({ ok: false, code: 'invalid_token' })
  })

  it('never reads credentials from the query string', () => {
    const request = new Request(`https://example.test/api/v1/items?access_token=${TOKEN}`)
    expect(readCredential(request.headers)).toEqual({ ok: false, code: 'unauthorized' })
  })

  it('builds the 401 problems', () => {
    expect(credentialProblem('unauthorized', REQUEST_ID)).toMatchObject({
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer realm="maqdar-api"' },
      body: { code: 'unauthorized' },
    })
    expect(credentialProblem('invalid_token', REQUEST_ID)).toMatchObject({
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer realm="maqdar-api", error="invalid_token"' },
      body: { code: 'invalid_token' },
    })
  })
})

describe('auth before request-shape problems (J8)', () => {
  const pending = toProblem('invalid_json', REQUEST_ID)
  const organization = (scopes: unknown) =>
    JSON.stringify({ organization: { name: 'A' }, key: { id: 'k', scopes } })

  it('reads the key scopes of an api_organization result', () => {
    expect(keyScopes({ key: { scopes: ['master_data:read', 'bogus'] } })).toEqual([
      'master_data:read',
    ])
    expect(keyScopes({ key: {} })).toBeNull()
    expect(keyScopes(null)).toBeNull()
  })

  it('returns the pending problem when the key has the scope', () => {
    expect(
      resolvePendingProblem({
        organizationText: organization(['master_data:write']),
        requiredScope: 'master_data:write',
        pending,
        requestId: REQUEST_ID,
      }),
    ).toBe(pending)
    expect(
      resolvePendingProblem({
        organizationText: organization([]),
        requiredScope: null,
        pending,
        requestId: REQUEST_ID,
      }),
    ).toBe(pending)
  })

  it('answers 403 when the key lacks the scope (write does not imply read)', () => {
    const problem = resolvePendingProblem({
      organizationText: organization(['master_data:write']),
      requiredScope: 'master_data:read',
      pending,
      requestId: REQUEST_ID,
    })
    expect(problem).toMatchObject({
      status: 403,
      body: { code: 'insufficient_scope', required_scope: 'master_data:read' },
    })
  })

  it('answers 500 for an unreadable result', () => {
    for (const organizationText of ['', 'not json', '{"key":{}}', 'null']) {
      expect(
        resolvePendingProblem({
          organizationText,
          requiredScope: 'master_data:read',
          pending,
          requestId: REQUEST_ID,
        }).status,
      ).toBe(500)
    }
  })
})
