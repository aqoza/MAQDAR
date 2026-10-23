import { describe, expect, it } from 'vitest'
import ar from '../../../../messages/ar.json'
import en from '../../../../messages/en.json'
import { API_SCOPES } from '../../../lib/api/auth'
import { displayKey } from '../../../lib/api/keys'
import { API_LIMITS } from '../../../lib/api/limits'
import {
  API_KEY_COLUMNS,
  EXPIRY_WARNING_DAYS,
  SCOPE_MESSAGE_KEYS,
  apiKeyErrorFields,
  apiKeyFormSchema,
  apiKeyStatus,
  isActiveApiKey,
  isApiKeyField,
  keyDisplay,
  listedApiKeys,
  scopeOptions,
  toApiKeyRows,
  type ApiKeyRecord,
} from './api-keys'

const NOW = Date.parse('2026-10-14T12:00:00Z')
const DAY = 86_400_000
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString()

function record(overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'ERP nightly sync',
    display_prefix: 'zeespare_sk_AbCd',
    last4: 'wxyz',
    scopes: ['master_data:read', 'master_data:write'],
    created_by: 'admin-user',
    created_at: at(-DAY),
    expires_at: at(90 * DAY),
    last_used_at: null,
    revoked_at: null,
    ...overrides,
  }
}

describe('scopes', () => {
  it('has a message key for every API scope, with label, badge and description', () => {
    expect(Object.keys(SCOPE_MESSAGE_KEYS)).toEqual([...API_SCOPES])
    for (const key of Object.values(SCOPE_MESSAGE_KEYS)) {
      const messages = en.ApiKeys.scopes[key]
      expect(Object.keys(messages).sort()).toEqual(['badge', 'description', 'label'])
      expect(Object.keys(ar.ApiKeys.scopes[key]).sort()).toEqual(['badge', 'description', 'label'])
    }
  })

  it('keeps the given order and drops values that are not scopes', () => {
    expect(scopeOptions(['transactions:write', 'nope', 'master_data:read'])).toEqual([
      { value: 'transactions:write', key: 'transactionsWrite' },
      { value: 'master_data:read', key: 'masterDataRead' },
    ])
    expect(scopeOptions(['__proto__', 'toString'])).toEqual([])
  })
})

describe('apiKeyStatus', () => {
  const status = (overrides: Partial<ApiKeyRecord>, creatorActive = true) =>
    apiKeyStatus({ ...record(overrides), creatorActive }, NOW)

  it('is active with a working creator and more than two weeks left', () => {
    expect(status({})).toEqual({ kind: 'active' })
    expect(status({ expires_at: at(EXPIRY_WARNING_DAYS * DAY) })).toEqual({ kind: 'active' })
  })

  it('counts the days left (rounded up) under two weeks', () => {
    expect(status({ expires_at: at(EXPIRY_WARNING_DAYS * DAY - 1) })).toEqual({
      kind: 'expiresSoon',
      days: 14,
    })
    expect(status({ expires_at: at(5 * DAY) })).toEqual({ kind: 'expiresSoon', days: 5 })
    expect(status({ expires_at: at(60_000) })).toEqual({ kind: 'expiresSoon', days: 1 })
  })

  it('is expired at and after expires_at', () => {
    expect(status({ expires_at: at(0) })).toEqual({ kind: 'expired' })
    expect(status({ expires_at: at(-DAY) })).toEqual({ kind: 'expired' })
    expect(status({ expires_at: 'not a date' })).toEqual({ kind: 'expired' })
  })

  it('flags a creator who is no longer an owner or admin', () => {
    expect(status({}, false)).toEqual({ kind: 'creatorInactive' })
    expect(status({ expires_at: at(DAY) }, false)).toEqual({ kind: 'creatorInactive' })
  })

  it('checks revoked, then expired, then the creator (the order of app.api_authorize)', () => {
    expect(status({ revoked_at: at(-1), expires_at: at(-DAY) }, false)).toEqual({
      kind: 'revoked',
    })
    expect(status({ expires_at: at(-DAY) }, false)).toEqual({ kind: 'expired' })
  })
})

describe('isActiveApiKey', () => {
  it('counts unrevoked, unexpired keys, whatever the creator', () => {
    expect(isActiveApiKey(record(), NOW)).toBe(true)
    expect(isActiveApiKey(record({ revoked_at: at(-1) }), NOW)).toBe(false)
    expect(isActiveApiKey(record({ expires_at: at(0) }), NOW)).toBe(false)
  })
})

describe('listedApiKeys', () => {
  it('keeps every active key, adds the newest others once, newest first', () => {
    const key = (id: string, day: number) => record({ id, created_at: at(day * DAY) })
    const oldActive = key('old-active', -300)
    const recent = [key('r3', -1), key('r2', -2), key('r1', -3)]
    const listed = listedApiKeys([key('r2', -2), oldActive], recent)
    expect(listed.map((k) => k.id)).toEqual(['r3', 'r2', 'r1', 'old-active'])
    expect(listedApiKeys([], [])).toEqual([])
    const tie = listedApiKeys([key('b', 0)], [key('a', 0)])
    expect(tie.map((k) => k.id)).toEqual(['a', 'b'])
  })
})

describe('rows', () => {
  it('shows keys as displayKey does', () => {
    expect(keyDisplay('zeespare_sk_AbCd', 'wxyz')).toBe('zeespare_sk_AbCd…wxyz')
    expect(keyDisplay('zeespare_sk_AbCd', 'wxyz')).toBe(displayKey('zeespare_sk_AbCd', 'wxyz'))
  })

  it('reads explicit columns, never key_hash', () => {
    const columns = API_KEY_COLUMNS.split(',').map((column) => column.trim())
    expect(columns).not.toContain('*')
    expect(columns).not.toContain('key_hash')
    expect(columns.sort()).toEqual(Object.keys(record()).sort())
  })

  it('maps creators through the members and marks keys whose creator lost the role', () => {
    const members = [
      { user_id: 'admin-user', email: 'admin@example.com', role: 'admin' },
      { user_id: 'owner-user', email: 'owner@example.com', role: 'owner' },
      { user_id: 'planner-user', email: 'planner@example.com', role: 'planner' },
    ]
    const rows = toApiKeyRows(
      [
        record({ id: 'a', created_by: 'admin-user' }),
        record({ id: 'b', created_by: 'owner-user', scopes: ['transactions:read'] }),
        record({ id: 'c', created_by: 'planner-user' }),
        record({ id: 'd', created_by: 'gone-user' }),
        record({ id: 'e', created_by: null, revoked_at: at(-1) }),
      ],
      members,
      NOW,
    )
    expect(rows.map((row) => [row.id, row.creator, row.status.kind])).toEqual([
      ['a', 'admin@example.com', 'active'],
      ['b', 'owner@example.com', 'active'],
      ['c', 'planner@example.com', 'creatorInactive'],
      ['d', null, 'creatorInactive'],
      ['e', null, 'revoked'],
    ])
    expect(rows[0]?.display).toBe('zeespare_sk_AbCd…wxyz')
    expect(rows[1]?.scopes).toEqual([{ value: 'transactions:read', key: 'transactionsRead' }])
  })
})

describe('apiKeyFormSchema', () => {
  const schema = apiKeyFormSchema(API_SCOPES, API_LIMITS.keyExpiryDays)
  const valid = { name: '  ERP sync  ', scopes: ['master_data:read'], expires_in_days: '90' }

  it('offers 30, 90, 180 and 365 days with 90 preselected', () => {
    expect(API_LIMITS.keyExpiryDays).toEqual([30, 90, 180, 365])
    expect(API_LIMITS.keyExpiryDays).toContain(API_LIMITS.defaultKeyExpiryDays)
    expect(API_LIMITS.defaultKeyExpiryDays).toBe(90)
  })

  it('trims the name and parses the expiry', () => {
    expect(schema.parse(valid)).toEqual({
      name: 'ERP sync',
      scopes: ['master_data:read'],
      expires_in_days: 90,
    })
  })

  it('counts the name in code points, like Postgres', () => {
    expect(schema.safeParse({ ...valid, name: '🔑'.repeat(80) }).success).toBe(true)
    expect(schema.safeParse({ ...valid, name: 'x'.repeat(81) }).success).toBe(false)
    expect(schema.safeParse({ ...valid, name: '   ' }).success).toBe(false)
  })

  it('refuses control characters in the name', () => {
    for (const name of ['a\tb', 'a\nb', 'a\u007fb', 'a\u0085b']) {
      expect(schema.safeParse({ ...valid, name }).success, JSON.stringify(name)).toBe(false)
    }
  })

  it('needs one or more known scopes, each once', () => {
    expect(schema.safeParse({ ...valid, scopes: [...API_SCOPES] }).success).toBe(true)
    for (const scopes of [[], ['master_data:read', 'master_data:read'], ['admin']]) {
      expect(schema.safeParse({ ...valid, scopes }).success, scopes.join()).toBe(false)
    }
  })

  it('accepts only the offered expiry periods', () => {
    for (const days of ['30', '180', '365']) {
      expect(schema.safeParse({ ...valid, expires_in_days: days }).success).toBe(true)
    }
    for (const days of ['', '0', '60', '366', '90.5', '-90', '1e2']) {
      expect(schema.safeParse({ ...valid, expires_in_days: days }).success, days).toBe(false)
    }
  })

  it('names the failing fields', () => {
    const result = schema.safeParse({ name: '', scopes: [], expires_in_days: '7' })
    expect(result.success).toBe(false)
    expect(apiKeyErrorFields(result.error?.issues ?? []).sort()).toEqual([
      'expires_in_days',
      'name',
      'scopes',
    ])
  })
})

describe('isApiKeyField', () => {
  it('accepts the MQ422 hints of create_api_key that are form fields', () => {
    expect(['name', 'scopes', 'expires_in_days'].every(isApiKeyField)).toBe(true)
    for (const hint of ['key_hash', 'display_prefix', 'last4', 'role', '', null]) {
      expect(isApiKeyField(hint)).toBe(false)
    }
  })
})
