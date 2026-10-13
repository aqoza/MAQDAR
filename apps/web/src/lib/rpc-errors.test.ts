import { describe, expect, it } from 'vitest'
import en from '../../messages/en.json'
import {
  RPC_ERROR_KEYS,
  errorHintField,
  isRpcCode,
  rpcErrorKey,
  violatedConstraint,
} from './rpc-errors'

describe('rpcErrorKey', () => {
  it('passes every known SQLSTATE through unchanged', () => {
    for (const key of RPC_ERROR_KEYS) {
      expect(rpcErrorKey({ code: key, message: 'x' })).toBe(key)
    }
  })

  it('covers the custom MAQDAR codes and the PostgreSQL constraint and privilege codes', () => {
    for (const code of ['MQ401', 'MQ403', 'MQ404', 'MQ409', 'MQ422', 'MQ429']) {
      expect(rpcErrorKey({ code })).toBe(code)
    }
    for (const code of ['23505', '23503', '23514', '23P01', '42501']) {
      expect(rpcErrorKey({ code })).toBe(code)
    }
  })

  it('maps lock conflicts to busy and statement timeouts to timeout', () => {
    expect(rpcErrorKey({ code: '55P03', message: 'canceling statement due to lock timeout' })).toBe(
      'busy',
    )
    expect(rpcErrorKey({ code: '40P01', message: 'deadlock detected' })).toBe('busy')
    expect(rpcErrorKey({ code: '40001' })).toBe('busy')
    expect(
      rpcErrorKey({ code: '57014', message: 'canceling statement due to statement timeout' }),
    ).toBe('timeout')
    // The import routes answer with these keys as their error code.
    expect(rpcErrorKey({ code: 'busy' })).toBe('busy')
    expect(rpcErrorKey({ code: 'timeout' })).toBe('timeout')
  })

  it('names the import lock conflict and keeps other MQ409 hints generic', () => {
    expect(rpcErrorKey({ code: 'MQ409', hint: 'import_in_progress' })).toBe('importInProgress')
    expect(rpcErrorKey({ code: 'MQ409', hint: 'another_commit' })).toBe('MQ409')
    expect(rpcErrorKey({ code: 'MQ409' })).toBe('MQ409')
    expect(rpcErrorKey({ code: 'MQ422', hint: 'import_in_progress' })).toBe('MQ422')
  })

  it('ignores inherited object keys', () => {
    expect(rpcErrorKey({ code: 'constructor' })).toBe('generic')
    expect(rpcErrorKey({ code: '__proto__' })).toBe('generic')
    expect(rpcErrorKey({ code: 'toString' })).toBe('generic')
  })

  it('falls back to generic for unknown, empty or missing codes', () => {
    expect(rpcErrorKey({ code: 'P0001', message: 'raise' })).toBe('generic')
    expect(rpcErrorKey({ code: '' })).toBe('generic')
    expect(rpcErrorKey({ code: null })).toBe('generic')
    expect(rpcErrorKey({})).toBe('generic')
    expect(rpcErrorKey(null)).toBe('generic')
    expect(rpcErrorKey(undefined)).toBe('generic')
  })

  it('never returns a key outside the RpcErrors namespace', () => {
    for (const code of ['generic', 'MQ999', 'mq401', '42P01', 'PGRST301']) {
      expect(RPC_ERROR_KEYS).toContain(rpcErrorKey({ code }))
    }
  })

  it('has a message for every key', () => {
    expect(Object.keys(en.RpcErrors).sort()).toEqual([...RPC_ERROR_KEYS].sort())
  })
})

describe('isRpcCode', () => {
  it('compares the SQLSTATE exactly', () => {
    expect(isRpcCode({ code: 'MQ409' }, 'MQ409')).toBe(true)
    expect(isRpcCode({ code: 'MQ409' }, 'MQ404')).toBe(false)
    expect(isRpcCode({ code: 'mq409' }, 'MQ409')).toBe(false)
  })

  it('is false for null or missing codes', () => {
    expect(isRpcCode(null, 'generic')).toBe(false)
    expect(isRpcCode(undefined, 'MQ401')).toBe(false)
    expect(isRpcCode({ code: null }, 'MQ401')).toBe(false)
    expect(isRpcCode({}, 'generic')).toBe(false)
  })
})

describe('violatedConstraint', () => {
  it('reads the constraint name from PostgreSQL messages', () => {
    expect(
      violatedConstraint({
        code: '23505',
        message: 'duplicate key value violates unique constraint "items_organization_id_code_key"',
      }),
    ).toBe('items_organization_id_code_key')
    expect(
      violatedConstraint({
        code: '23503',
        message:
          'insert or update on table "items" violates foreign key constraint "items_brand_fkey"',
      }),
    ).toBe('items_brand_fkey')
    expect(
      violatedConstraint({
        code: '23514',
        message: 'new row for relation "items" violates check constraint "items_name_ar_check"',
      }),
    ).toBe('items_name_ar_check')
    expect(
      violatedConstraint({
        code: '23P01',
        message:
          'conflicting key value violates exclusion constraint "holiday_overrides_no_overlap"',
      }),
    ).toBe('holiday_overrides_no_overlap')
  })

  it('falls back to the details and ignores other codes', () => {
    expect(
      violatedConstraint({ code: '23503', message: 'x', details: 'see constraint "a_fkey"' }),
    ).toBe('a_fkey')
    expect(violatedConstraint({ code: 'MQ422', message: 'constraint "x"' })).toBeNull()
    expect(violatedConstraint({ code: '23505', message: 'no name here' })).toBeNull()
    expect(violatedConstraint(null)).toBeNull()
  })
})

describe('errorHintField', () => {
  it('returns identifier-like hints only', () => {
    expect(errorHintField({ code: 'MQ422', hint: 'successor_item_code' })).toBe(
      'successor_item_code',
    )
    expect(errorHintField({ code: 'MQ422', hint: ' parent_location_id ' })).toBe(
      'parent_location_id',
    )
    expect(errorHintField({ code: 'MQ422', hint: 'Use another value.' })).toBeNull()
    expect(errorHintField({ code: 'MQ422', hint: null })).toBeNull()
    expect(errorHintField(undefined)).toBeNull()
  })
})
