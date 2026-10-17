import { describe, expect, it } from 'vitest'
import type { RpcErrorLike } from '../rpc-errors'
import {
  API_CACHE_CONTROL,
  PROBLEMS,
  PROBLEM_CODES,
  PROBLEM_CONTENT_TYPE,
  apiProblemFor,
  bodyReadProblem,
  isProblemCode,
  jsonResponse,
  mapUpsertResult,
  parameterProblem,
  problemResponse,
  requestProblem,
  resultItem,
  serverTiming,
  toProblem,
  wwwAuthenticate,
  type ApiProblem,
  type ProblemCode,
  type ProblemInit,
} from './problem'

const REQUEST_ID = '0b5f3a52-6c1e-4f43-9d55-1f0c2b7a9e10'
const LEAK = 'relation "public.items" violates check constraint items_secret_check'

/** Keys that must never appear in any problem, at any depth. */
function forbiddenKeys(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item) => forbiddenKeys(item, found))
  else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (['sqlstate', 'message', 'phase', 'stack', 'hint'].includes(key)) found.push(key)
      forbiddenKeys(item, found)
    }
  }
  return found
}

function expectClean(problem: ApiProblem) {
  expect(forbiddenKeys(problem.body)).toEqual([])
  expect(JSON.stringify(problem.body)).not.toContain(LEAK)
  expect(JSON.stringify(problem.body)).not.toMatch(/\b(?:MQ\d{3}|[0-9]{2}P[0-9]{2}|PGRST\d{3})\b/)
}

function rpc(code: string, hint?: string, details?: string): RpcErrorLike {
  return { code, hint: hint ?? null, details: details ?? null, message: LEAK }
}

describe('toProblem', () => {
  it('builds RFC 9457 members for every code, with status equal to the HTTP status', () => {
    expect(PROBLEM_CODES).toHaveLength(22)
    for (const code of PROBLEM_CODES) {
      const problem = toProblem(code, REQUEST_ID, { allow: 'GET' })
      expect(problem.status).toBe(PROBLEMS[code].status)
      expect(problem.body).toMatchObject({
        type: `urn:maqdar:problem:${code}`,
        title: PROBLEMS[code].title,
        status: problem.status,
        detail: PROBLEMS[code].detail,
        instance: `urn:uuid:${REQUEST_ID}`,
        code,
        request_id: REQUEST_ID,
      })
      expect(Object.keys(problem.body).slice(0, 7)).toEqual([
        'type',
        'title',
        'status',
        'detail',
        'instance',
        'code',
        'request_id',
      ])
      expect(isProblemCode(code)).toBe(true)
    }
    expect(isProblemCode('generic')).toBe(false)
  })

  it('adds the standard headers per code', () => {
    const header = (code: ProblemCode, init: ProblemInit = {}) =>
      toProblem(code, REQUEST_ID, init).headers
    expect(header('unauthorized')).toEqual({ 'WWW-Authenticate': 'Bearer realm="maqdar-api"' })
    expect(header('invalid_token')).toEqual({
      'WWW-Authenticate': 'Bearer realm="maqdar-api", error="invalid_token"',
    })
    expect(header('insufficient_scope', { requiredScope: 'master_data:write' })).toEqual({
      'WWW-Authenticate':
        'Bearer realm="maqdar-api", error="insufficient_scope", scope="master_data:write"',
    })
    expect(header('busy')).toEqual({ 'Retry-After': '2' })
    expect(header('write_conflict')).toEqual({ 'Retry-After': '2' })
    expect(header('import_in_progress')).toEqual({ 'Retry-After': '5' })
    expect(header('import_in_progress', { retryAfter: 30 })).toEqual({ 'Retry-After': '30' })
    expect(header('rate_limited')).toEqual({ 'Retry-After': '60' })
    expect(header('daily_limit')).toEqual({ 'Retry-After': '3600' })
    expect(header('timeout')).toEqual({ 'Retry-After': '5' })
    expect(header('unavailable')).toEqual({ 'Retry-After': '5' })
    expect(header('method_not_allowed', { allow: 'POST' })).toEqual({ Allow: 'POST' })
    for (const code of [
      'invalid_json',
      'not_found',
      'internal_error',
      'validation_failed',
    ] as const) {
      expect(header(code)).toEqual({})
    }
  })

  it('names the required scope and keeps reserved and forbidden members out of extensions', () => {
    const problem = toProblem('insufficient_scope', REQUEST_ID, {
      requiredScope: 'transactions:read',
      extensions: {
        status: 200,
        code: 'x',
        sqlstate: '23514',
        message: LEAK,
        nested: { phase: 'merge', ok: 1, list: [{ message: LEAK, keep: true }] },
      },
    })
    expect(problem.body.status).toBe(403)
    expect(problem.body.code).toBe('insufficient_scope')
    expect(problem.body.required_scope).toBe('transactions:read')
    expect(problem.body.nested).toEqual({ ok: 1, list: [{ keep: true }] })
    expectClean(problem)
  })

  it('formats the WWW-Authenticate challenges', () => {
    expect(wwwAuthenticate()).toBe('Bearer realm="maqdar-api"')
    expect(wwwAuthenticate('insufficient_scope', null)).toBe(
      'Bearer realm="maqdar-api", error="insufficient_scope"',
    )
  })
})

describe('apiProblemFor', () => {
  const post = {
    requestId: REQUEST_ID,
    method: 'POST',
    requiredScope: 'master_data:write',
  } as const
  const get = { requestId: REQUEST_ID, method: 'GET', requiredScope: 'master_data:read' } as const
  const map = (error: RpcErrorLike, context: typeof post | typeof get = post) => {
    const mapped = apiProblemFor(error, context)
    expectClean(mapped.problem)
    return mapped
  }

  it('maps MQ401 hints to invalid_token with their own detail', () => {
    const details = new Set<string>()
    for (const hint of ['api_key', 'revoked', 'expired', 'creator_inactive']) {
      const { problem, unexpected } = map(rpc('MQ401', hint))
      expect(problem.status).toBe(401)
      expect(problem.body.code).toBe('invalid_token')
      expect(problem.headers['WWW-Authenticate']).toContain('error="invalid_token"')
      expect(unexpected).toBe(false)
      details.add(problem.body.detail)
    }
    expect(details.size).toBe(4)
    expect(map(rpc('MQ401', 'Not An Identifier')).problem.body.detail).toBe(
      'The API key is not valid.',
    )
  })

  it('maps scope, not-found and write-cap errors', () => {
    const scope = map(rpc('MQ403', 'scope')).problem
    expect(scope.status).toBe(403)
    expect(scope.body.required_scope).toBe('master_data:write')
    expect(scope.headers['WWW-Authenticate']).toContain('scope="master_data:write"')
    expect(map(rpc('MQ404', 'resource')).problem.body.code).toBe('not_found')
    expect(map(rpc('MQ429', 'api_writes_per_day')).problem).toMatchObject({
      status: 429,
      headers: { 'Retry-After': '3600' },
      body: { code: 'daily_limit' },
    })
    expect(map(rpc('MQ429', 'other')).problem.body.code).toBe('rate_limited')
  })

  it('maps the import lock and the committing slot to 409 with their Retry-After', () => {
    expect(map(rpc('MQ409', 'import_in_progress')).problem).toMatchObject({
      status: 409,
      headers: { 'Retry-After': '5' },
      body: { code: 'import_in_progress' },
    })
    expect(map(rpc('MQ409', 'another_commit')).problem).toMatchObject({
      status: 409,
      headers: { 'Retry-After': '30' },
      body: { code: 'import_in_progress' },
    })
    expect(map(rpc('MQ409', 'something_else')).problem.body.code).toBe('busy')
    for (const code of ['55P03', '40P01', '40001']) {
      expect(map(rpc(code)).problem).toMatchObject({
        status: 409,
        headers: { 'Retry-After': '2' },
        body: { code: 'busy' },
      })
    }
  })

  it('maps MQ422 to a 400 parameter problem on GET and a 422 on POST', () => {
    expect(map(rpc('MQ422', 'cursor'), get).problem).toMatchObject({
      status: 400,
      body: { code: 'invalid_cursor' },
    })
    const limit = map(rpc('MQ422', 'limit'), get).problem
    expect(limit.status).toBe(400)
    expect(limit.body.code).toBe('invalid_parameter')
    expect(limit.body.errors).toEqual([
      { parameter: 'limit', detail: 'Must be a whole number within the list limits.' },
    ])
    expect(map(rpc('MQ422', 'unknown_hint'), get).problem.body.errors).toEqual([])
    expect(
      apiProblemFor(rpc('MQ422', 'cursor'), { requestId: REQUEST_ID, method: 'HEAD' }).problem
        .status,
    ).toBe(400)

    const records = map(rpc('MQ422', 'records', '{"record": 3, "field": "unit_cost"}')).problem
    expect(records.status).toBe(422)
    expect(records.body).toMatchObject({
      code: 'invalid_request',
      error_count: 1,
      errors_truncated: false,
      errors: [
        {
          pointer: '#/records/3/unit_cost',
          record: 3,
          field: 'unit_cost',
          code: 'invalid_record',
        },
      ],
    })
    const coded = map(rpc('MQ422', 'records', '{"record": 0, "code": "inconsistent_fields"}'))
    expect(coded.problem.body.errors).toEqual([
      {
        pointer: '#/records/0',
        record: 0,
        field: null,
        code: 'inconsistent_fields',
        detail: 'Every record must carry the same fields as the first record.',
      },
    ])
    const garbage = map(rpc('MQ422', 'records', `{"record": -1, "field": "${'x'.repeat(65)}"}`))
    expect(garbage.problem.body.errors).toEqual([
      {
        pointer: '#/records',
        record: null,
        field: null,
        code: 'invalid_record',
        detail: 'The record does not follow the request rules.',
      },
    ])
    expect(map(rpc('MQ422', 'records', 'not json')).problem.status).toBe(422)
    // Shapes app.api_check_fields reports (detail {code, record?, field?, limit?}).
    expect(
      map(rpc('MQ422', 'records', '{"code": "too_many_records", "limit": 1000}')).problem,
    ).toMatchObject({ status: 413, body: { code: 'too_many_records', limit: 1000 } })
    expect(
      map(rpc('MQ422', 'records', '{"code": "unknown_field", "field": "extra key"}')).problem.body
        .errors,
    ).toEqual([
      {
        pointer: '#/extra%20key',
        record: null,
        field: 'extra key',
        code: 'unknown_field',
        detail: 'Not a field of this resource.',
      },
    ])
    expect(
      map(rpc('MQ422', 'records', '{"code": "missing_records"}')).problem.body.errors,
    ).toMatchObject([{ pointer: '#/records', record: null, field: null, code: 'missing_records' }])
    expect(
      map(rpc('MQ422', 'records', '{"code": "invalid_type", "record": 7, "field": "is_active"}'))
        .problem.body.errors,
    ).toMatchObject([{ pointer: '#/records/7/is_active', code: 'invalid_type' }])
    expect(map(rpc('MQ422', 'resource')).problem.body.code).toBe('invalid_request')
  })

  it('maps values PostgreSQL refused to invalid_json on POST', () => {
    for (const code of ['22P02', '22P05', '22003']) {
      expect(map(rpc(code)).problem).toMatchObject({ status: 400, body: { code: 'invalid_json' } })
      expect(map(rpc(code), get).problem.body.code).toBe('invalid_parameter')
    }
  })

  it('maps timeouts and unreachable databases to 503 with Retry-After', () => {
    expect(map(rpc('57014')).problem).toMatchObject({
      status: 503,
      headers: { 'Retry-After': '5' },
      body: { code: 'timeout' },
    })
    for (const code of [
      'fetch_failed',
      'http_502',
      'http_503',
      'http_504',
      'PGRST000',
      'PGRST003',
    ]) {
      const mapped = map(rpc(code))
      expect(mapped.problem.body.code).toBe('unavailable')
      expect(mapped.unexpected).toBe(false)
    }
  })

  it('answers 500 with the request id only for everything else', () => {
    for (const error of [
      rpc('PGRST202'),
      rpc('PGRST301'),
      rpc('PGRST302'),
      rpc('PGRST303'),
      rpc('42501'),
      rpc('MQ499'),
      rpc('23514'),
      rpc('http_500'),
      rpc(''),
      null,
      undefined,
    ]) {
      const mapped = map(error)
      expect(mapped.problem.status).toBe(500)
      expect(mapped.problem.body.code).toBe('internal_error')
      expect(mapped.unexpected).toBe(true)
      expect(Object.keys(mapped.problem.body)).toEqual([
        'type',
        'title',
        'status',
        'detail',
        'instance',
        'code',
        'request_id',
      ])
    }
  })
})

describe('Worker-side problems', () => {
  it('maps body reads, request shapes and parameters', () => {
    expect(bodyReadProblem(413, REQUEST_ID)).toMatchObject({
      status: 413,
      body: { code: 'payload_too_large', limit: 1_048_576 },
    })
    expect(bodyReadProblem(400, REQUEST_ID).body.code).toBe('invalid_json')
    expect(
      requestProblem(
        { ok: false, code: 'too_many_records', records: 1_001, limit: 1_000 },
        REQUEST_ID,
      ),
    ).toMatchObject({
      status: 413,
      body: { code: 'too_many_records', limit: 1_000, records: 1_001 },
    })
    const issue = {
      pointer: '#/records/0/x',
      record: 0,
      field: 'x',
      code: 'unknown_field' as const,
      detail: 'Not a field of this resource.',
    }
    expect(
      requestProblem(
        { ok: false, code: 'invalid_request', errors: [issue], errorCount: 120, truncated: true },
        REQUEST_ID,
      ),
    ).toMatchObject({
      status: 422,
      body: { code: 'invalid_request', error_count: 120, errors: [issue], errors_truncated: true },
    })
    expect(
      parameterProblem(
        { ok: false, code: 'invalid_cursor', errors: [{ parameter: 'cursor', detail: 'x' }] },
        REQUEST_ID,
      ),
    ).toMatchObject({ status: 400, body: { code: 'invalid_cursor' } })
  })
})

describe('mapUpsertResult', () => {
  const context = { requestId: REQUEST_ID, resource: 'items' }
  const importId = '6f1d7a3e-2b4c-4d5e-8f90-a1b2c3d4e5f6'

  it('answers 200 for recorded and unrecorded successes', () => {
    const recorded = mapUpsertResult(
      {
        result: 'succeeded',
        import_id: importId,
        recorded: true,
        entity: 'items',
        records: 3,
        counts: { inserted: 2, updated: 1, unchanged: 0, deleted: 0, skipped: 0, bogus: 9 },
        warning_count: 0,
        warnings: [],
        warnings_truncated: false,
      },
      context,
    )
    expect(recorded).toEqual({
      ok: true,
      status: 200,
      body: {
        import_id: importId,
        recorded: true,
        request_id: REQUEST_ID,
        resource: 'items',
        records: 3,
        counts: { inserted: 2, updated: 1, unchanged: 0, deleted: 0, skipped: 0 },
        warning_count: 0,
        warnings: [],
        warnings_truncated: false,
      },
    })
    const unchanged = mapUpsertResult(
      {
        result: 'succeeded',
        import_id: null,
        recorded: false,
        records: 1,
        counts: { unchanged: 0, skipped: 1 },
        warning_count: 1,
        warnings: [{ pointer: '#/records/0', record: 0, code: 'zero_row_new_key' }],
        warnings_truncated: false,
      },
      context,
    )
    expect(unchanged.ok && unchanged.body).toMatchObject({
      import_id: null,
      recorded: false,
      warnings: [
        {
          pointer: '#/records/0',
          record: 0,
          field: null,
          code: 'zero_row_new_key',
          detail: 'Both quantities are 0 for a day without demand; the record was skipped.',
        },
      ],
    })
  })

  it('answers 422 validation_failed with items rebuilt from an allow-list', () => {
    const outcome = mapUpsertResult(
      {
        result: 'invalid',
        error_count: 3,
        error_counts: { duplicate_key: { '': 1 }, too_many_decimals: { unit_cost: 1 }, 'x y': {} },
        errors_truncated: false,
        errors: [
          {
            pointer: '#/records/4',
            record: 4,
            field: null,
            code: 'duplicate_key',
            value: 'A-1',
            detail: { first_record: 1, first_file_no: 1, phase: 'stage', sqlstate: '23505' },
          },
          {
            pointer: 'javascript:alert(1)',
            record: 0,
            field: 'unit_cost',
            code: 'too_many_decimals',
            value: '1'.repeat(500),
            detail: { message: LEAK, stored: { lead_time_days_p50: '5', 'bad key': 'x' } },
          },
          { code: 'BAD CODE' },
          'not an object',
        ],
        warning_count: 0,
        warnings: [],
      },
      context,
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.unexpected).toBe(false)
    expect(outcome.problem.status).toBe(422)
    expectClean(outcome.problem)
    expect(outcome.problem.body).toMatchObject({
      code: 'validation_failed',
      error_count: 3,
      error_counts: { duplicate_key: { '': 1 }, too_many_decimals: { unit_cost: 1 } },
      errors_truncated: false,
      warning_count: 0,
      warnings: [],
    })
    const errors = outcome.problem.body.errors as Record<string, unknown>[]
    expect(errors).toHaveLength(2)
    expect(errors[0]).toEqual({
      pointer: '#/records/4',
      record: 4,
      field: null,
      code: 'duplicate_key',
      value: 'A-1',
      detail: 'This key appears more than once in the request. First at record 1.',
      first_record: 1,
    })
    expect(errors[1]).toMatchObject({
      pointer: '#/records/0/unit_cost',
      code: 'too_many_decimals',
      stored: { lead_time_days_p50: '5' },
    })
    expect((errors[1]?.value as string).length).toBe(200)
  })

  it('answers 409 write_conflict for a commit-time conflict', () => {
    const outcome = mapUpsertResult(
      {
        result: 'conflict',
        failure_code: 'changed_during_commit',
        error_count: 1,
        error_counts: { changed_during_commit: { '': 1 } },
        errors: [
          {
            pointer: '#/records/2',
            record: 2,
            field: '',
            code: 'changed_during_commit',
            detail: { phase: 'merge', sqlstate: '23503', message: LEAK, first_record: 2 },
          },
        ],
        errors_truncated: false,
      },
      context,
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expectClean(outcome.problem)
    expect(outcome.problem).toMatchObject({
      status: 409,
      headers: { 'Retry-After': '2' },
      body: {
        code: 'write_conflict',
        failure_code: 'changed_during_commit',
        error_count: 1,
        errors: [{ pointer: '#/records/2', record: 2, field: null, code: 'changed_during_commit' }],
      },
    })
  })

  it('answers 500 for anything else', () => {
    for (const result of [null, 'text', [], {}, { result: 'pending' }]) {
      const outcome = mapUpsertResult(result, context)
      expect(outcome.ok).toBe(false)
      if (!outcome.ok) {
        expect(outcome.problem.status).toBe(500)
        expect(outcome.unexpected).toBe(true)
      }
    }
  })

  it('refuses result items without a usable code', () => {
    expect(resultItem({ code: 'Bad' })).toBeNull()
    expect(resultItem(null)).toBeNull()
    expect(resultItem({ code: 'required', record: 1.5, field: 'Name' })).toEqual({
      pointer: '#/records',
      record: null,
      field: null,
      code: 'required',
      detail: 'A value is required.',
    })
  })
})

describe('responses', () => {
  it('sends problems as application/problem+json, never cached, with extra headers', async () => {
    const problem = toProblem('rate_limited', REQUEST_ID)
    const response = problemResponse(problem, { 'X-Request-Id': REQUEST_ID, 'Retry-After': '1' })
    expect(response.status).toBe(429)
    expect(response.headers.get('content-type')).toBe(PROBLEM_CONTENT_TYPE)
    expect(response.headers.get('cache-control')).toBe(API_CACHE_CONTROL)
    expect(response.headers.get('x-request-id')).toBe(REQUEST_ID)
    expect(response.headers.get('retry-after')).toBe('60')
    expect(await response.json()).toEqual(problem.body)
  })

  it('passes JSON text through untouched and serializes other bodies', async () => {
    const text = '{"data":[{"unit_cost":"12.50000000000000000001"}],"next_cursor":null}'
    const passthrough = jsonResponse(200, text, { 'X-Request-Id': REQUEST_ID })
    expect(await passthrough.text()).toBe(text)
    expect(passthrough.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(passthrough.headers.get('cache-control')).toBe('no-store')
    expect(await jsonResponse(200, { a: 1 }).text()).toBe('{"a":1}')
  })

  it('formats Server-Timing', () => {
    expect(serverTiming({ db: 12.345, total: 20 })).toBe('db;dur=12.3, total;dur=20.0')
    expect(serverTiming({ total: 1.26 })).toBe('total;dur=1.3')
    expect(serverTiming({ db: null, total: -1 })).toBe('total;dur=0.0')
  })
})
