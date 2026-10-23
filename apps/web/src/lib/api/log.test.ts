import { describe, expect, it, vi } from 'vitest'
import { hashApiKey } from './keys'
import { apiLogEntry, logApiRequest, type ApiLogInput } from './log'

const TOKEN = 'zeespare_sk_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefg0QUuQI'
const REQUEST_ID = '5c8e3a1b-7d2f-4e6a-9b0c-1d2e3f4a5b6c'

async function input(overrides: Partial<ApiLogInput> = {}): Promise<ApiLogInput> {
  return {
    requestId: REQUEST_ID,
    cfRay: '8f3b2c1d0e9a8b7c-DXB',
    method: 'POST',
    operation: 'upsert:items',
    status: 200,
    code: null,
    keyHash: await hashApiKey(TOKEN),
    records: 3,
    dbMs: 41.27,
    totalMs: 47.81,
    ...overrides,
  }
}

describe('apiLogEntry', () => {
  it('keeps ids, codes, counts, timings and an 8-hex key prefix', async () => {
    expect(apiLogEntry(await input())).toEqual({
      msg: 'api',
      request_id: REQUEST_ID,
      cf_ray: '8f3b2c1d0e9a8b7c-DXB',
      method: 'POST',
      operation: 'upsert:items',
      status: 200,
      code: null,
      key: '5ce42b3e',
      records: 3,
      db_ms: 41.3,
      total_ms: 47.8,
    })
  })

  it('never logs the key, the header, the body or values (redaction)', async () => {
    const hash = await hashApiKey(TOKEN)
    const hostile = {
      ...(await input({ status: 500, sqlstate: '23514' })),
      errorMessage: `invalid input syntax: "secret-value"; Authorization: Bearer ${TOKEN}`,
      authorization: `Bearer ${TOKEN}`,
      token: TOKEN,
      body: '{"records":[{"unit_cost":"secret-value"}]}',
    } as ApiLogInput
    const entry = apiLogEntry(hostile)
    const text = JSON.stringify(entry)
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain(hash.slice(2, 20))
    expect(text).not.toContain('secret-value')
    expect(text).not.toContain('Bearer')
    expect(Object.keys(entry).sort()).toEqual(
      [
        'cf_ray',
        'code',
        'db_ms',
        'key',
        'method',
        'msg',
        'operation',
        'records',
        'request_id',
        'sqlstate',
        'status',
        'total_ms',
      ].sort(),
    )
    expect(entry).not.toHaveProperty('error')
  })

  it('logs only a validated SQLSTATE for 5xx answers', async () => {
    const entry = apiLogEntry(await input({ status: 422, sqlstate: 'MQ422' }))
    expect(entry).not.toHaveProperty('sqlstate')
    expect(entry).not.toHaveProperty('error')
    expect(apiLogEntry(await input({ status: 500, sqlstate: 'PGRST202' })).sqlstate).toBe(
      'PGRST202',
    )
    expect(apiLogEntry(await input({ status: 503, sqlstate: 'fetch_failed' })).sqlstate).toBe(
      'fetch_failed',
    )
    expect(apiLogEntry(await input({ status: 500, sqlstate: 'DROP TABLE x' }))).not.toHaveProperty(
      'sqlstate',
    )
  })

  it('replaces malformed fields', async () => {
    const entry = apiLogEntry(
      await input({
        requestId: 'nope',
        cfRay: 'x y',
        method: 'post me',
        operation: 'Upsert Items!',
        code: 'Bad Code',
        keyHash: null,
        records: -1,
        dbMs: Number.NaN,
        totalMs: Number.POSITIVE_INFINITY,
      }),
    )
    expect(entry).toMatchObject({
      request_id: 'invalid',
      cf_ray: null,
      method: 'OTHER',
      operation: 'other',
      code: null,
      key: null,
      records: null,
      db_ms: null,
      total_ms: 0,
    })
  })
})

describe('logApiRequest', () => {
  it('logs one line, as an error for 5xx', async () => {
    const logger = { log: vi.fn(), error: vi.fn() }
    logApiRequest(await input(), logger)
    logApiRequest(await input({ status: 503, code: 'timeout' }), logger)
    expect(logger.log).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error.mock.calls[0]?.[0]).toMatchObject({
      msg: 'api',
      status: 503,
      code: 'timeout',
    })
  })
})
