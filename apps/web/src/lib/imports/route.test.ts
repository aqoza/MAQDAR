import { describe, expect, it, vi } from 'vitest'
import {
  BODY_LIMIT,
  CHUNK_BODY_LIMIT,
  CHUNK_ROWS_LIMIT,
  ERROR_REPORT_HEADER,
  NO_STORE,
  attachmentDisposition,
  errorMessageFormatter,
  errorMessageValues,
  errorReportFields,
  guardMutation,
  isJsonContentType,
  isRetryableStepError,
  isSameOrigin,
  jsonResponse,
  mapRpcError,
  parseIntSegment,
  parseIntValue,
  parseJsonObject,
  parseUuid,
  readBodyText,
  redirectResponse,
  rowsLiteral,
  rpcErrorResponse,
  runSteps,
  stageChunkPayload,
  stepIsDone,
  unexpectedErrorResponse,
  unlistedReportLines,
  utf8ByteLength,
  type ErrorMessageSource,
  type ImportErrorRow,
  type StepResult,
} from './route'

const SITE = 'http://localhost:3000'
const URL_ = `${SITE}/api/imports/x/commit`

function request(
  init: {
    origin?: string | null
    contentType?: string | null
    body?: BodyInit
    length?: string
  } = {},
  url = URL_,
): Request {
  const headers = new Headers()
  if (init.origin !== null) headers.set('origin', init.origin ?? SITE)
  if (init.contentType !== null) headers.set('content-type', init.contentType ?? 'application/json')
  if (init.length !== undefined) headers.set('content-length', init.length)
  return new Request(url, { method: 'POST', headers, body: init.body ?? '{}' })
}

/** A body without Content-Length, delivered in pieces. */
function streamedRequest(pieces: Uint8Array[]): Request {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(piece)
      controller.close()
    },
  })
  return new Request(URL_, {
    method: 'PUT',
    headers: { origin: SITE, 'content-type': 'application/json' },
    body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' })
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

describe('isSameOrigin', () => {
  it('accepts the request URL origin', () => {
    expect(isSameOrigin(request(), undefined)).toBe(true)
  })

  it('accepts the configured site origin, with or without a trailing slash or path', () => {
    const behindProxy = request(
      { origin: 'https://maqdar.org' },
      'http://10.0.0.5:8080/api/imports',
    )
    expect(isSameOrigin(behindProxy, 'https://maqdar.org')).toBe(true)
    expect(isSameOrigin(behindProxy, 'https://maqdar.org/')).toBe(true)
    expect(isSameOrigin(behindProxy, 'https://maqdar.org/app')).toBe(true)
    expect(isSameOrigin(behindProxy, undefined)).toBe(false)
  })

  it('refuses a missing, opaque or foreign origin', () => {
    expect(isSameOrigin(request({ origin: null }), SITE)).toBe(false)
    expect(isSameOrigin(request({ origin: 'null' }), SITE)).toBe(false)
    expect(isSameOrigin(request({ origin: 'https://evil.example' }), SITE)).toBe(false)
    expect(isSameOrigin(request({ origin: 'http://localhost:3001' }), SITE)).toBe(false)
    expect(isSameOrigin(request({ origin: 'https://localhost:3000' }), SITE)).toBe(false)
    expect(isSameOrigin(request({ origin: 'http://localhost:3000.evil.example' }), SITE)).toBe(
      false,
    )
  })

  it('ignores an unparsable site URL', () => {
    expect(isSameOrigin(request({ origin: 'https://maqdar.org' }), 'not a url')).toBe(false)
    expect(isSameOrigin(request(), 'not a url')).toBe(true)
  })
})

describe('isJsonContentType', () => {
  it('accepts application/json with parameters, in any case', () => {
    expect(isJsonContentType('application/json')).toBe(true)
    expect(isJsonContentType('application/json; charset=utf-8')).toBe(true)
    expect(isJsonContentType('Application/JSON ;charset=UTF-8')).toBe(true)
  })

  it('refuses form, text and other JSON-like types', () => {
    for (const type of [
      null,
      '',
      'text/plain',
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=x',
      'application/json-patch+json',
      'application/jsonx',
      'text/json',
    ]) {
      expect(isJsonContentType(type)).toBe(false)
    }
  })
})

describe('readBodyText', () => {
  it('reads a body within the cap, exactly at the cap and an empty body', async () => {
    expect(await readBodyText(request({ body: '{"a":1}' }), 100)).toEqual({
      ok: true,
      text: '{"a":1}',
    })
    expect(await readBodyText(request({ body: 'x'.repeat(10) }), 10)).toEqual({
      ok: true,
      text: 'x'.repeat(10),
    })
    expect(await readBodyText(request({ body: '' }), 10)).toEqual({ ok: true, text: '' })
  })

  it('refuses a declared Content-Length over the cap without reading', async () => {
    const result = await readBodyText(request({ body: '{}', length: '2000000' }), BODY_LIMIT)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(413)
    expect(await bodyOf(result.response)).toEqual({ code: 'payload_too_large', hint: 'body' })
  })

  it('stops reading a streamed body as soon as it exceeds the cap', async () => {
    const piece = new Uint8Array(400).fill(0x61)
    const result = await readBodyText(streamedRequest([piece, piece, piece]), 1_000)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(413)
    const fits = await readBodyText(streamedRequest([piece, piece]), 1_000)
    expect(fits).toEqual({ ok: true, text: 'a'.repeat(800) })
  })

  it('decodes UTF-8 split across pieces and refuses invalid UTF-8', async () => {
    const arabic = new TextEncoder().encode('{"name":"زيت"}')
    const split = await readBodyText(streamedRequest([arabic.slice(0, 10), arabic.slice(10)]), 100)
    expect(split).toEqual({ ok: true, text: '{"name":"زيت"}' })
    const invalid = await readBodyText(streamedRequest([new Uint8Array([0x7b, 0xff, 0x7d])]), 100)
    expect(invalid.ok).toBe(false)
    if (invalid.ok) return
    expect(invalid.response.status).toBe(400)
    expect(await bodyOf(invalid.response)).toEqual({ code: 'bad_request', hint: 'body' })
  })
})

describe('parseJsonObject', () => {
  it('parses objects and treats an empty body as {}', () => {
    expect(parseJsonObject('{"rows_total":5}')).toEqual({ rows_total: 5 })
    expect(parseJsonObject('')).toEqual({})
    expect(parseJsonObject('  \n')).toEqual({})
  })

  it('refuses arrays, scalars, null and invalid JSON', () => {
    for (const text of ['[]', '[1]', '1', '"x"', 'null', 'true', '{', "{'a':1}"]) {
      expect(parseJsonObject(text)).toBeNull()
    }
  })
})

describe('guardMutation', () => {
  it('passes a same-origin JSON request and returns its body', async () => {
    const result = await guardMutation(request({ body: '{"max_rows":100}' }), {
      siteUrl: undefined,
    })
    expect(result).toEqual({ ok: true, body: { max_rows: 100 } })
  })

  it('checks the origin first (403), then the content type (415)', async () => {
    const crossSiteForm = request({
      origin: 'https://evil.example',
      contentType: 'application/x-www-form-urlencoded',
      body: 'a=1',
    })
    const first = await guardMutation(crossSiteForm, { siteUrl: undefined })
    expect(first.ok).toBe(false)
    if (first.ok) return
    expect(first.response.status).toBe(403)
    expect(await bodyOf(first.response)).toEqual({ code: 'cross_origin' })
    expect(first.response.headers.get('cache-control')).toBe(NO_STORE)

    const sameSiteForm = request({ contentType: 'text/plain', body: '{}' })
    const second = await guardMutation(sameSiteForm, { siteUrl: undefined })
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.response.status).toBe(415)
    expect(await bodyOf(second.response)).toEqual({ code: 'unsupported_media_type' })
  })

  it('caps the body (413) and refuses non-object JSON (400)', async () => {
    const big = await guardMutation(request({ body: `{"rows":"${'x'.repeat(2_000)}"}` }), {
      siteUrl: undefined,
      maxBytes: 1_000,
    })
    expect(big.ok).toBe(false)
    if (!big.ok) expect(big.response.status).toBe(413)

    const array = await guardMutation(request({ body: '[1,2]' }), { siteUrl: undefined })
    expect(array.ok).toBe(false)
    if (array.ok) return
    expect(array.response.status).toBe(400)
    expect(await bodyOf(array.response)).toEqual({ code: 'bad_request', hint: 'body' })
  })

  it('allows a full chunk wrapped in {"rows": …} through the chunk cap', async () => {
    // A worst-case chunk: every other character a quote, which JSON escaping doubles.
    const rows = '["",'.repeat(Math.floor(CHUNK_ROWS_LIMIT / 4) - 1) + '""]'
    expect(utf8ByteLength(rows)).toBeLessThanOrEqual(CHUNK_ROWS_LIMIT)
    const body = JSON.stringify({ rows })
    expect(body.length).toBeGreaterThan(1_100_000)
    const result = await guardMutation(request({ body }), {
      siteUrl: undefined,
      maxBytes: CHUNK_BODY_LIMIT,
    })
    expect(result.ok).toBe(true)
  })
})

describe('parameters', () => {
  it('parses UUIDs into lower case', () => {
    expect(parseUuid('3F2504E0-4F89-41D3-9A0C-0305E82C3301')).toBe(
      '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    )
    for (const value of ['', 'x', '3f2504e0-4f89-41d3-9a0c-0305e82c330', 42, null, undefined]) {
      expect(parseUuid(value)).toBeNull()
    }
    expect(parseUuid("3f2504e0-4f89-41d3-9a0c-0305e82c3301' or 1=1")).toBeNull()
  })

  it('parses canonical integer path segments within bounds', () => {
    expect(parseIntSegment('1', 1, 60)).toBe(1)
    expect(parseIntSegment('60', 1, 60)).toBe(60)
    expect(parseIntSegment('2147483647', 1, 2_147_483_647)).toBe(2_147_483_647)
    for (const value of ['0', '61', '01', '+1', '-1', '1.0', '1e3', ' 1', '', '99999999999']) {
      expect(parseIntSegment(value, 1, 60)).toBeNull()
    }
    expect(parseIntSegment(undefined, 1, 60)).toBeNull()
  })

  it('parses JSON integers within bounds', () => {
    expect(parseIntValue(0, 0, 10)).toBe(0)
    expect(parseIntValue(10, 0, 10)).toBe(10)
    for (const value of [-1, 11, 1.5, '5', null, undefined, Number.NaN, Infinity]) {
      expect(parseIntValue(value, 0, 10)).toBeNull()
    }
  })
})

describe('mapRpcError', () => {
  it('maps the custom SQLSTATEs to their HTTP status with hint and message', () => {
    const cases: [string, number][] = [
      ['MQ401', 401],
      ['MQ403', 403],
      ['MQ404', 404],
      ['MQ409', 409],
      ['MQ422', 422],
      ['MQ429', 429],
    ]
    for (const [code, status] of cases) {
      const mapped = mapRpcError({ code, hint: 'file_no', message: 'the message' })
      expect(mapped).toEqual({
        status,
        body: { code, hint: 'file_no', message: 'the message' },
        unexpected: false,
      })
    }
  })

  it('drops hints that are not identifiers', () => {
    expect(mapRpcError({ code: 'MQ422', hint: 'Use another value.', message: 'm' }).body).toEqual({
      code: 'MQ422',
      message: 'm',
    })
    expect(mapRpcError({ code: 'MQ404' }).body).toEqual({ code: 'MQ404' })
  })

  it('asks for a retry on import_in_progress', () => {
    const mapped = mapRpcError({ code: 'MQ409', hint: 'import_in_progress', message: 'busy' })
    expect(mapped.status).toBe(409)
    expect(mapped.retryAfter).toBe(2)
  })

  it('maps statement timeouts to 503 timeout and lock conflicts to 409 busy', () => {
    expect(mapRpcError({ code: '57014', message: 'canceling statement' })).toEqual({
      status: 503,
      body: { code: 'timeout' },
      retryAfter: 5,
      unexpected: false,
    })
    for (const code of ['55P03', '40P01', '40001']) {
      expect(mapRpcError({ code, message: 'deadlock detected, process 42' })).toEqual({
        status: 409,
        body: { code: 'busy' },
        retryAfter: 2,
        unexpected: false,
      })
    }
  })

  it('maps invalid input to 400, privileges to 403 and JWT problems to 401', () => {
    expect(mapRpcError({ code: '22P02', message: 'invalid input syntax' })).toEqual({
      status: 400,
      body: { code: 'bad_request' },
      unexpected: false,
    })
    expect(mapRpcError({ code: '42501' }).status).toBe(403)
    expect(mapRpcError({ code: 'PGRST301' })).toEqual({
      status: 401,
      body: { code: 'MQ401' },
      unexpected: false,
    })
  })

  it('treats everything else as unexpected', () => {
    for (const error of [
      { code: 'P0001', message: 'raise' },
      { code: '23505', message: 'duplicate' },
      { code: 'PGRST202', message: 'function not found' },
      { code: '', message: 'fetch failed' },
      null,
      undefined,
    ]) {
      expect(mapRpcError(error)).toEqual({
        status: 500,
        body: { code: 'generic' },
        unexpected: true,
      })
    }
  })
})

describe('rpcErrorResponse', () => {
  it('sends Retry-After and no-store', async () => {
    const logger = { error: vi.fn() }
    const response = rpcErrorResponse({ code: '57014', message: 'x' }, 'test', logger)
    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe('5')
    expect(response.headers.get('cache-control')).toBe(NO_STORE)
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(await bodyOf(response)).toEqual({ code: 'timeout' })
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('logs unexpected errors with a request id that the client also gets', async () => {
    const logger = { error: vi.fn() }
    const response = rpcErrorResponse(
      { code: 'XX000', message: 'internal', details: 'secret detail', hint: 'h' },
      'POST /api/imports',
      logger,
    )
    expect(response.status).toBe(500)
    const body = await bodyOf(response)
    expect(body.code).toBe('generic')
    expect(body.request_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(response.headers.get('x-request-id')).toBe(body.request_id)
    expect(logger.error).toHaveBeenCalledWith('imports route failed', {
      request_id: body.request_id,
      route: 'POST /api/imports',
      code: 'XX000',
      message: 'internal',
    })
    expect(JSON.stringify(body)).not.toContain('secret detail')
  })

  it('turns thrown exceptions into a logged 500', async () => {
    const logger = { error: vi.fn() }
    const response = unexpectedErrorResponse(new TypeError('fetch failed'), 'x', logger)
    expect(response.status).toBe(500)
    expect((await bodyOf(response)).code).toBe('generic')
    expect(logger.error).toHaveBeenCalledOnce()
  })
})

describe('responses', () => {
  it('never lets a response be cached', () => {
    expect(jsonResponse({ a: 1 }).headers.get('cache-control')).toBe(NO_STORE)
    expect(jsonResponse(null, 202).status).toBe(202)
    const redirect = redirectResponse('https://storage.example/object?token=t')
    expect(redirect.status).toBe(302)
    expect(redirect.headers.get('location')).toBe('https://storage.example/object?token=t')
    expect(redirect.headers.get('cache-control')).toBe(NO_STORE)
  })
})

describe('rowsLiteral and stageChunkPayload', () => {
  const samples = [
    '[[1,"P-1","Oil filter",null]]',
    '[[1,"قطعة ١","a \\"quoted\\" \\\\ value"]]',
    'ends with a backslash \\',
    'controls \n\t\r and \u0000 and   and 😀',
    '"',
  ]

  it('passes the client envelope on unchanged, as p_rows of the RPC body', () => {
    for (const rows of samples) {
      const literal = rowsLiteral(JSON.stringify({ rows }))
      expect(literal, rows).not.toBeNull()
      const payload = JSON.parse(stageChunkPayload('b-1', 2, 5001, literal as string)) as Record<
        string,
        unknown
      >
      expect(payload).toEqual({ p_batch_id: 'b-1', p_file_no: 2, p_first_row: 5001, p_rows: rows })
    }
  })

  it('refuses every other shape (those bodies are parsed as JSON instead)', () => {
    for (const text of [
      '{"rows":"a","rows":"b"}',
      '{"rows":"a","p_batch_id":"x"}',
      '{"rows":"abc\\"}',
      '{ "rows": "x" }',
      '{"rows":5}',
      '{"rows":"line\nbreak"}',
      '{"rows":"x"} ',
      '{"rows":"',
      '',
    ]) {
      expect(rowsLiteral(text), text).toBeNull()
    }
    expect(rowsLiteral('{"rows":""}')).toBe('""')
  })
})

describe('utf8ByteLength', () => {
  it('equals the encoded length for ASCII, Arabic, emoji and lone surrogates', () => {
    const encoder = new TextEncoder()
    for (const text of [
      '',
      'abc',
      'زيت المحرك',
      '[1,"P-1","٣"]',
      'a😀b',
      'éࠀ',
      'x\ud800y',
      '\udc00',
    ]) {
      expect(utf8ByteLength(text)).toBe(encoder.encode(text).byteLength)
    }
  })
})

describe('runSteps', () => {
  type R = { done: boolean; n: number }

  /** A fake clock: each step advances time by `stepMs`. */
  function harness(results: StepResult<R>[], stepMs = 100) {
    let time = 0
    let index = 0
    const sleeps: number[] = []
    const step = vi.fn(async () => {
      time += stepMs
      const result = results[Math.min(index, results.length - 1)]!
      index += 1
      return result
    })
    const options = {
      now: () => time,
      sleep: async (ms: number) => {
        sleeps.push(ms)
        time += ms
      },
    }
    return { step, options, sleeps }
  }
  const ok = (n: number, done = false): StepResult<R> => ({ data: { done, n }, error: null })
  const fail = (code: string, hint?: string): StepResult<R> => ({
    data: null,
    error: { code, hint, message: code },
  })
  const isDone = (result: R) => result.done

  it('stops at the first done result', async () => {
    const { step, options } = harness([ok(1), ok(2), ok(3, true), ok(4)])
    const outcome = await runSteps(step, isDone, options)
    expect(outcome).toEqual({ last: { done: true, n: 3 }, error: null, done: true, steps: 3 })
    expect(step).toHaveBeenCalledTimes(3)
  })

  it('stops before a step would exceed the budget', async () => {
    const { step, options } = harness([ok(1)], 3_000)
    const outcome = await runSteps(step, isDone, { ...options, budgetMs: 20_000 })
    expect(outcome.done).toBe(false)
    expect(outcome.error).toBeNull()
    // 3 s per step: after 6 steps (18 s) another one would end past 20 s.
    expect(outcome.steps).toBe(6)
  })

  it('retries lock conflicts after a pause and resets the retry count after a success', async () => {
    const { step, options, sleeps } = harness([
      fail('40P01'),
      ok(1),
      fail('MQ409', 'import_in_progress'),
      fail('55P03'),
      ok(2, true),
    ])
    const outcome = await runSteps(step, isDone, { ...options, retryDelaysMs: [10, 20, 30] })
    expect(outcome).toEqual({ last: { done: true, n: 2 }, error: null, done: true, steps: 2 })
    expect(sleeps).toEqual([10, 10, 20])
  })

  it('reports a lock conflict that outlasts the retries before any progress', async () => {
    const { step, options } = harness([fail('40P01')])
    const outcome = await runSteps(step, isDone, { ...options, retryDelaysMs: [10, 20] })
    expect(outcome.error?.code).toBe('40P01')
    expect(outcome.last).toBeNull()
    expect(step).toHaveBeenCalledTimes(3)
  })

  it('answers with the last result when a later step hits a transient error', async () => {
    for (const error of [fail('40P01'), fail('57014')]) {
      const { step, options } = harness([ok(1), error])
      const outcome = await runSteps(step, isDone, { ...options, retryDelaysMs: [] })
      expect(outcome).toEqual({ last: { done: false, n: 1 }, error: null, done: false, steps: 1 })
    }
  })

  it('reports other errors even after progress, and a timeout on the first step', async () => {
    const after = harness([ok(1), fail('MQ409', 'status')])
    const outcome = await runSteps(after.step, isDone, after.options)
    expect(outcome.error?.code).toBe('MQ409')
    expect(outcome.last).toEqual({ done: false, n: 1 })

    const first = harness([fail('57014')])
    const timeout = await runSteps(first.step, isDone, first.options)
    expect(timeout.error?.code).toBe('57014')
    expect(first.step).toHaveBeenCalledTimes(1)
  })

  it('treats an empty result as an error', async () => {
    const { step, options } = harness([{ data: null, error: null }])
    const outcome = await runSteps(step, isDone, options)
    expect(outcome.error?.code).toBe('empty_result')
  })

  it('knows which errors are worth an immediate retry', () => {
    expect(isRetryableStepError({ code: '40P01' })).toBe(true)
    expect(isRetryableStepError({ code: '55P03' })).toBe(true)
    expect(isRetryableStepError({ code: 'MQ409', hint: 'import_in_progress' })).toBe(true)
    expect(isRetryableStepError({ code: 'MQ409', hint: 'another_commit' })).toBe(false)
    expect(isRetryableStepError({ code: '57014' })).toBe(false)
    expect(isRetryableStepError(null)).toBe(false)
  })

  it('reads done from step results', () => {
    expect(stepIsDone({ done: true })).toBe(true)
    expect(stepIsDone({ done: false })).toBe(false)
    expect(stepIsDone({ done: 'true' })).toBe(false)
    expect(stepIsDone(null)).toBe(false)
    expect(stepIsDone([true])).toBe(false)
  })
})

describe('attachmentDisposition', () => {
  it('names ASCII files directly', () => {
    expect(attachmentDisposition('items.csv')).toBe(
      `attachment; filename="items.csv"; filename*=UTF-8''items.csv`,
    )
  })

  it('keeps Arabic names in filename* with an ASCII fallback', () => {
    const header = attachmentDisposition('بنود 2026.csv')
    expect(header).toBe(
      `attachment; filename="____ 2026.csv"; filename*=UTF-8''%D8%A8%D9%86%D9%88%D8%AF%202026.csv`,
    )
  })

  it('never lets quotes, separators or line breaks into the header', () => {
    const header = attachmentDisposition('a"b;c\r\nSet-Cookie: x=1/../é\\(1)\'.csv')
    expect(header).not.toMatch(/[\r\n]/)
    const fallback = /filename="([^"]*)"/.exec(header)?.[1] ?? ''
    expect(fallback).not.toMatch(/["\\/;]/)
    expect(header).toContain(
      `filename*=UTF-8''a%22b%3Bc__Set-Cookie%3A%20x%3D1_.._%C3%A9_%281%29%27.csv`,
    )
    expect(attachmentDisposition('')).toBe(
      `attachment; filename="download"; filename*=UTF-8''download`,
    )
  })
})

describe('error report', () => {
  const row = (overrides: Partial<ImportErrorRow> = {}): ImportErrorRow => ({
    id: 1,
    file_no: 1,
    row_no: 4,
    column_name: 'unit_cost',
    code: 'too_many_decimals',
    level: 'error',
    value: '1.2345',
    detail: null,
    ...overrides,
  })

  it('ends with a line per file whose details were not all stored', () => {
    const files = [
      {
        file_no: 2,
        original_name: 'demand.csv',
        error_count: 1_000_000,
        warning_count: 5,
        errors_stored: 10_000,
        error_counts: {
          invalid_date: { demand_date: 999_990 },
          required: { quantity: 10 },
          source_missing: { '': 5 },
        },
      },
      {
        file_no: 1,
        original_name: 'items.csv',
        error_count: 3,
        warning_count: 0,
        errors_stored: 3,
        error_counts: { required: { name_en: 3 } },
      },
    ]
    const lines = unlistedReportLines(files, ({ count, codes }) => `${count} more: ${codes}`)
    expect(lines).toEqual([
      [
        'demand.csv',
        '',
        '',
        '',
        '',
        '',
        '990005 more: invalid_date: 999990, required: 10, source_missing: 5',
      ],
    ])
  })

  it('has the documented header', () => {
    expect([...ERROR_REPORT_HEADER]).toEqual([
      'file',
      'row',
      'column',
      'code',
      'level',
      'value',
      'message',
    ])
  })

  it('writes file-level errors without a row number', () => {
    expect(errorReportFields(row(), 'items.csv', 'Too many decimals')).toEqual([
      'items.csv',
      4,
      'unit_cost',
      'too_many_decimals',
      'error',
      '1.2345',
      'Too many decimals',
    ])
    expect(
      errorReportFields(
        row({ row_no: 0, column_name: '', value: null, code: 'source_missing' }),
        '',
        'm',
      ),
    ).toEqual(['', '', '', 'source_missing', 'error', '', 'm'])
  })

  it('collects message values from the row and the scalar detail fields', () => {
    const values = errorMessageValues(
      row({
        code: 'end_before_start',
        detail: {
          phase: 'commit',
          stored: { introduced_on: '2024-05-01', 'bad key': 1 },
          first_row: 3,
          nested: { a: 1 },
          list: [1],
          'Bad-Key': 'x',
          observed: false,
        },
      }),
      'items.csv',
    )
    expect(values).toEqual({
      phase: 'commit',
      stored_introduced_on: '2024-05-01',
      first_row: 3,
      observed: 'false',
      file: 'items.csv',
      row: 4,
      column: 'unit_cost',
      value: '1.2345',
    })
  })

  function source(messages: Record<string, string>): ErrorMessageSource & {
    format: ReturnType<typeof vi.fn>
  } {
    const format = vi.fn((code: string, values?: Record<string, string | number>) => {
      const text = messages[code]!
      if (!text.includes('{')) return text
      // A tiny ICU stand-in: {name} replaced, a missing value gives the next-intl fallback.
      let missing = false
      const result = text.replace(/\{(\w+)\}/g, (_, name: string) => {
        if (!values || !(name in values)) missing = true
        return String(values?.[name] ?? '')
      })
      return missing ? `ImportErrors.${code}` : result
    })
    return {
      has: (code) => Object.hasOwn(messages, code),
      raw: (code) => messages[code],
      format,
    }
  }

  it('formats constant messages once per code and parametric ones per row', () => {
    const messages = source({
      too_many_decimals: 'Too many decimals.',
      duplicate_key: 'Same key as row {first_row}.',
    })
    const message = errorMessageFormatter(messages)
    expect(message(row(), 'items.csv')).toBe('Too many decimals.')
    expect(message(row({ id: 2 }), 'items.csv')).toBe('Too many decimals.')
    expect(messages.format).toHaveBeenCalledTimes(1)
    const duplicate = row({ code: 'duplicate_key', detail: { first_row: 2, first_file_no: 1 } })
    expect(message(duplicate, 'items.csv')).toBe('Same key as row 2.')
    expect(message({ ...duplicate, detail: { first_row: 7 } }, 'items.csv')).toBe(
      'Same key as row 7.',
    )
  })

  it('falls back to the code for unknown codes and failed formatting', () => {
    const message = errorMessageFormatter(
      source({ p90_below_p50: 'Below {stored_lead_time_days}.' }),
    )
    expect(message(row({ code: 'brand_new_code' }), 'f')).toBe('brand_new_code')
    expect(message(row({ code: 'p90_below_p50' }), 'f')).toBe('p90_below_p50')
    expect(
      message(row({ code: 'p90_below_p50', detail: { stored: { lead_time_days: 20 } } }), 'f'),
    ).toBe('Below 20.')
    const throwing = errorMessageFormatter({
      has: () => true,
      raw: () => 'x {a}',
      format: () => {
        throw new Error('bad message')
      },
    })
    expect(throwing(row(), 'f')).toBe('too_many_decimals')
  })
})
