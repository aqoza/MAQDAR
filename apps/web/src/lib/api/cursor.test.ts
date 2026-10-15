import { describe, expect, it } from 'vitest'
import {
  isRfc3339DateTime,
  isWellFormedCursor,
  listParameters,
  listRpcCall,
  parseDate,
  parseListQuery,
  type ListQueryResult,
} from './cursor'
import { hashApiKey } from './keys'

const params = (query: string) => new URLSearchParams(query)

function errors(result: ListQueryResult) {
  if (result.ok) throw new Error('expected a failure')
  return result
}

describe('master-data lists', () => {
  it('defaults the limit and reads limit, cursor and updated_since', () => {
    expect(parseListQuery('items', params(''))).toEqual({
      ok: true,
      query: { kind: 'master', entity: 'items', limit: 100, cursor: null, updatedSince: null },
    })
    expect(
      parseListQuery(
        'items',
        params('limit=1000&cursor=eyJ2IjoxfQ&updated_since=2026-10-01T00:00:00Z'),
      ),
    ).toEqual({
      ok: true,
      query: {
        kind: 'master',
        entity: 'items',
        limit: 1000,
        cursor: 'eyJ2IjoxfQ',
        updatedSince: '2026-10-01T00:00:00Z',
      },
    })
  })

  it('refuses out-of-range limits instead of clamping', () => {
    for (const limit of ['0', '1001', '-1', '1.5', '01', '1e3', 'abc', ' 5', '9999999999']) {
      const result = errors(parseListQuery('items', params(`limit=${encodeURIComponent(limit)}`)))
      expect(result.code, limit).toBe('invalid_parameter')
      expect(result.errors).toEqual([
        { parameter: 'limit', detail: 'Must be a whole number from 1 to 1000.' },
      ])
    }
    expect(parseListQuery('items', params('limit=1')).ok).toBe(true)
  })

  it('refuses unknown, repeated and empty parameters', () => {
    expect(errors(parseListQuery('items', params('Limit=5&page=2&page=3'))).errors).toEqual([
      {
        parameter: 'Limit',
        detail: 'Unknown parameter; this list takes limit, cursor, updated_since.',
      },
      {
        parameter: 'page',
        detail: 'Unknown parameter; this list takes limit, cursor, updated_since.',
      },
    ])
    expect(errors(parseListQuery('items', params('limit=5&limit=6'))).errors).toEqual([
      { parameter: 'limit', detail: 'Given more than once.' },
    ])
    expect(errors(parseListQuery('items', params('cursor='))).errors).toEqual([
      { parameter: 'cursor', detail: 'Must not be empty.' },
    ])
    expect(errors(parseListQuery('items', params('from=2026-01-01'))).code).toBe(
      'invalid_parameter',
    )
  })

  it('answers invalid_cursor when the cursor is the only problem', () => {
    const bad = errors(parseListQuery('items', params('cursor=abc%2Bdef')))
    expect(bad.code).toBe('invalid_cursor')
    expect(errors(parseListQuery('items', params(`cursor=${'a'.repeat(1025)}`))).code).toBe(
      'invalid_cursor',
    )
    expect(errors(parseListQuery('items', params('cursor=abc=&limit=0'))).code).toBe(
      'invalid_parameter',
    )
    expect(parseListQuery('items', params(`cursor=${'a'.repeat(1024)}`)).ok).toBe(true)
  })

  it('checks updated_since as RFC 3339 with an offset', () => {
    expect(
      errors(parseListQuery('items', params('updated_since=2026-10-01'))).errors[0]?.parameter,
    ).toBe('updated_since')
  })
})

describe('demand lists', () => {
  it('requires from and to and reads the filters', () => {
    expect(errors(parseListQuery('demand_history', params(''))).errors).toEqual([
      { parameter: 'from', detail: 'Required (YYYY-MM-DD).' },
      { parameter: 'to', detail: 'Required (YYYY-MM-DD).' },
    ])
    expect(
      parseListQuery(
        'demand_history',
        params(
          'from=2026-01-01&to=2026-12-31&item_code=FAL%2FBRK-1&location_code=JED-BR1&limit=5000',
        ),
      ),
    ).toEqual({
      ok: true,
      query: {
        kind: 'demand',
        entity: 'demand_history',
        from: '2026-01-01',
        to: '2026-12-31',
        itemCode: 'FAL/BRK-1',
        locationCode: 'JED-BR1',
        limit: 5000,
        cursor: null,
      },
    })
    expect(parseListQuery('demand_history', params('from=2026-01-01&to=2026-01-01'))).toMatchObject(
      {
        ok: true,
        query: { limit: 1000, itemCode: null, locationCode: null },
      },
    )
  })

  it('allows at most 366 days, from and to included', () => {
    expect(parseListQuery('demand_history', params('from=2024-01-01&to=2024-12-31')).ok).toBe(true)
    expect(parseListQuery('demand_history', params('from=2023-01-01&to=2024-01-01')).ok).toBe(true)
    expect(
      errors(parseListQuery('demand_history', params('from=2023-01-01&to=2024-01-02'))).errors,
    ).toEqual([
      { parameter: 'to', detail: 'The range may span at most 366 days (from and to included).' },
    ])
    expect(
      errors(parseListQuery('demand_history', params('from=2026-02-01&to=2026-01-31'))).errors,
    ).toEqual([{ parameter: 'to', detail: 'Must not be before from.' }])
  })

  it('refuses invalid dates, codes and master-data parameters', () => {
    const result = errors(
      parseListQuery(
        'demand_history',
        params(
          'from=2026-02-30&to=2026-13-01&item_code=-x&location_code=a/b&updated_since=x&limit=5001',
        ),
      ),
    )
    expect(result.errors.map((error) => error.parameter).sort()).toEqual([
      'from',
      'item_code',
      'limit',
      'location_code',
      'to',
      'updated_since',
    ])
  })

  it('lists the accepted parameters', () => {
    expect(listParameters('items')).toEqual(['limit', 'cursor', 'updated_since'])
    expect(listParameters('demand_history')).toEqual([
      'from',
      'to',
      'item_code',
      'location_code',
      'limit',
      'cursor',
    ])
  })
})

describe('value checks', () => {
  it('parses calendar dates only', () => {
    expect(parseDate('2024-02-29')).toBe(Date.UTC(2024, 1, 29))
    expect(parseDate('2023-02-29')).toBeNull()
    expect(parseDate('0001-01-01')).not.toBeNull()
    expect(parseDate('0099-12-31')).not.toBeNull()
    expect(parseDate('0000-01-01')).toBeNull()
    expect(parseDate('2026-1-01')).toBeNull()
    expect(parseDate('2026-01-01T00:00:00Z')).toBeNull()
  })

  it('accepts RFC 3339 date-times with an offset', () => {
    for (const value of [
      '2026-10-01T00:00:00Z',
      '2026-10-01t00:00:00z',
      '2026-10-01T12:34:56.123456Z',
      '2026-10-01T12:34:56.123456789+03:00',
      '2026-10-01T23:59:59-05:30',
    ]) {
      expect(isRfc3339DateTime(value), value).toBe(true)
    }
    for (const value of [
      '2026-10-01',
      '2026-10-01T00:00:00',
      '2026-10-01 00:00:00Z',
      '2026-10-01T24:00:00Z',
      '2026-10-01T00:60:00Z',
      '2026-02-30T00:00:00Z',
      '2026-10-01T00:00:00+24:00',
      '2026-10-01T00:00:00.Z',
      '2026-10-01T00:00:00.1234567890Z',
    ]) {
      expect(isRfc3339DateTime(value), value).toBe(false)
    }
  })

  it('checks cursor length and alphabet only', () => {
    expect(isWellFormedCursor('eyJ2IjoxLCJrIjoiaXRlbXMifQ')).toBe(true)
    expect(isWellFormedCursor('a-b_c')).toBe(true)
    expect(isWellFormedCursor('')).toBe(false)
    expect(isWellFormedCursor('ab+c')).toBe(false)
    expect(isWellFormedCursor('abc=')).toBe(false)
  })
})

describe('listRpcCall', () => {
  it('maps queries to the api_list and api_list_demand arguments', async () => {
    const hash = await hashApiKey('maqdar_sk_x')
    const master = parseListQuery('items', params('limit=2'))
    const demand = parseListQuery(
      'demand_history',
      params('from=2026-01-01&to=2026-01-31&cursor=abc'),
    )
    if (!master.ok || !demand.ok) throw new Error('expected valid queries')
    expect(listRpcCall(master.query, hash)).toEqual({
      name: 'api_list',
      args: {
        p_key_hash: hash,
        p_entity: 'items',
        p_limit: 2,
        p_after: null,
        p_updated_since: null,
      },
    })
    expect(listRpcCall(demand.query, hash)).toEqual({
      name: 'api_list_demand',
      args: {
        p_key_hash: hash,
        p_from: '2026-01-01',
        p_to: '2026-01-31',
        p_item_code: null,
        p_location_code: null,
        p_limit: 1000,
        p_after: 'abc',
      },
    })
  })
})
