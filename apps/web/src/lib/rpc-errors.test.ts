import { describe, expect, it } from 'vitest'
import { RPC_ERROR_KEYS, isRpcCode, rpcErrorKey } from './rpc-errors'

describe('rpcErrorKey', () => {
  it('passes every known SQLSTATE through unchanged', () => {
    for (const key of RPC_ERROR_KEYS) {
      expect(rpcErrorKey({ code: key, message: 'x' })).toBe(key)
    }
  })

  it('covers the custom MAQDAR codes and the PostgreSQL constraint codes', () => {
    expect(rpcErrorKey({ code: 'MQ401' })).toBe('MQ401')
    expect(rpcErrorKey({ code: 'MQ403' })).toBe('MQ403')
    expect(rpcErrorKey({ code: 'MQ404' })).toBe('MQ404')
    expect(rpcErrorKey({ code: 'MQ409' })).toBe('MQ409')
    expect(rpcErrorKey({ code: 'MQ422' })).toBe('MQ422')
    expect(rpcErrorKey({ code: 'MQ429' })).toBe('MQ429')
    expect(rpcErrorKey({ code: '23505' })).toBe('23505')
    expect(rpcErrorKey({ code: '23503' })).toBe('23503')
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
