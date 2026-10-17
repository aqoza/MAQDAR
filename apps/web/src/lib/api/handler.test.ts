import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { RateLimitBinding } from './bindings'
import {
  INDEX_BODY,
  OPENAPI_CACHE_CONTROL,
  handleIndex,
  handleOpenApi,
  handleOrganization,
  handleResource,
  handleResourceDetail,
  hasContentEncoding,
  ifNoneMatchHits,
  isJsonMediaType,
  noParameters,
  notFound,
  openApiSource,
  strongEtag,
  type ApiDeps,
  type ApiMethod,
  type ApiUpsertInput,
} from './handler'
import type { ApiLogEntry } from './log'
import { recordCap } from './limits'
import { resetRateLimitWarning } from './rate-limit'
import { API_DOCS_URL, OPENAPI_PATH } from './resources'
import type { ApiRpcResult } from './rpc-request'

/* ------------------------------------------------------------------------------------------ */
/* Fixtures                                                                                     */
/* ------------------------------------------------------------------------------------------ */

const REQUEST_ID = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b'
/** The shared key vector of keys.test.ts and pgTAP 0022 (valid format and checksum). */
const TOKEN = 'maqdar_sk_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefg27zRqD'
const HASH = '\\x57c5db9f1c461c47073a614bba4368a3902a3fa56525f94fa8fab6528f35efcb'
const BASE = 'https://maqdar.test/api/v1'
const LEAK = 'permission denied for function api_upsert (secret detail)'

const ALL_SCOPES = [
  'transfer_handoffs:read',
  'purchase_handoffs:read',
  'purchase_handoffs:acknowledge',
  'master_data:read',
  'master_data:write',
  'transactions:read',
  'transactions:write',
]

function organizationText(scopes: string[] = ALL_SCOPES): string {
  return JSON.stringify({
    organization: {
      name: 'Acme',
      slug: 'acme',
      base_currency: 'SAR',
      home_country: 'SA',
      time_zone: 'Asia/Riyadh',
    },
    key: {
      id: '0b5f3a52-6c1e-4f43-9d55-1f0c2b7a9e10',
      name: 'ERP',
      display: 'maqdar_sk_0123…RqD',
      scopes,
      created_at: '2026-10-01T00:00:00.000000Z',
      expires_at: '2026-12-30T00:00:00.000000Z',
    },
    demand_window: { from: '2023-01-01', until_exclusive: '2026-10-15' },
    limits: {},
  })
}

function ok(text: string, ms = 5): ApiRpcResult {
  return { ok: true, status: 200, text, ms }
}

function rpcError(
  code: string,
  hint: string | null = null,
  details: string | null = null,
  status = 400,
): ApiRpcResult {
  return { ok: false, status, error: { code, message: LEAK, details, hint }, ms: 3 }
}

type RpcCall = { name: string; args: Record<string, unknown> }

type Fake = {
  deps: ApiDeps
  rpcCalls: RpcCall[]
  upsertCalls: ApiUpsertInput[]
  logs: ApiLogEntry[]
  errors: ApiLogEntry[]
  platformCalls: number
  limiterKeys: string[]
}

type FakeOptions = {
  rpc?: Record<string, ApiRpcResult | (() => ApiRpcResult | Promise<ApiRpcResult>)>
  upsert?: ApiRpcResult | (() => ApiRpcResult | Promise<ApiRpcResult>)
  ipLimiter?: RateLimitBinding | null
  keyLimiter?: RateLimitBinding | null
}

function fake(options: FakeOptions = {}): Fake {
  let clock = 0
  const state: Fake = {
    rpcCalls: [],
    upsertCalls: [],
    logs: [],
    errors: [],
    platformCalls: 0,
    limiterKeys: [],
    deps: undefined as unknown as ApiDeps,
  }
  const resolve = async (
    value: ApiRpcResult | (() => ApiRpcResult | Promise<ApiRpcResult>) | undefined,
    name: string,
  ): Promise<ApiRpcResult> => {
    if (value === undefined) throw new Error(`unexpected RPC ${name}`)
    return typeof value === 'function' ? value() : value
  }
  state.deps = {
    rpc: async (name, args) => {
      state.rpcCalls.push({ name, args: args as Record<string, unknown> })
      return resolve(options.rpc?.[name], name)
    },
    upsert: async (input) => {
      state.upsertCalls.push(input)
      return resolve(options.upsert, 'api_upsert')
    },
    platform: () => {
      state.platformCalls += 1
      return { ipLimiter: options.ipLimiter ?? null, keyLimiter: options.keyLimiter ?? null }
    },
    logger: {
      log: (entry: unknown) => state.logs.push(entry as ApiLogEntry),
      error: (entry: unknown) => state.errors.push(entry as ApiLogEntry),
    },
    now: () => (clock += 10),
    requestId: () => REQUEST_ID,
  }
  return state
}

function limiter(state: Fake, allow: (key: string) => boolean): RateLimitBinding {
  return {
    limit: async ({ key }) => {
      state.limiterKeys.push(key)
      return { success: allow(key) }
    },
  }
}

function request(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Request {
  const method = init.method ?? 'GET'
  return new Request(`${BASE}${path}`, {
    method: method === 'HEAD' ? 'HEAD' : method,
    headers: init.headers,
    body: init.body,
  })
}

const AUTH = { authorization: `Bearer ${TOKEN}` }
const JSON_HEADERS = { ...AUTH, 'content-type': 'application/json' }

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

function only<T>(items: T[]): T {
  expect(items).toHaveLength(1)
  return items[0] as T
}

beforeEach(() => resetRateLimitWarning())

describe('handoff acknowledgements', () => {
  const id = '98000000-0000-4000-8000-000000000001'
  const event = '98000000-0000-4000-8000-000000000002'
  const value = {
    client_event_id: event,
    external_system: 'ERP',
    external_reference: '00123',
    status: 'received',
  }
  const base = `/purchase-handoffs/${id}/acknowledgements`
  const route = (
    state: Fake,
    method: ApiMethod,
    suffix = '',
    payload?: string,
    headers = JSON_HEADERS,
  ) =>
    handleResourceDetail(
      request(base + suffix, {
        method,
        headers,
        ...(payload === undefined ? {} : { body: payload }),
      }),
      method,
      'purchase-handoffs',
      [id, 'acknowledgements', ...(suffix.startsWith('/') ? [suffix.slice(1)] : [])],
      state.deps,
    )
  it.each([false, true])(
    'returns creation/retry status and a readable location (replayed %s)',
    async (replayed) => {
      const raw = JSON.stringify({ data: { id: event, external_reference: '00123' }, replayed })
      const state = fake({ rpc: { api_handoff_acknowledge: ok(raw) } })
      const response = await route(state, 'POST', '', JSON.stringify(value))
      expect(response.status).toBe(replayed ? 200 : 201)
      expect(response.headers.get('location')).toBe(`/api/v1${base}/${event}`)
      expect(response.headers.get('cache-control')).toContain('no-store')
      expect(await response.text()).toBe(raw)
      expect(state.rpcCalls).toEqual([
        {
          name: 'api_handoff_acknowledge',
          args: { p_key_hash: HASH, p_resource: 'purchase-handoffs', p_id: id, p_body: value },
        },
      ])
      expect(JSON.stringify(state.logs)).not.toContain('00123')
      expect(JSON.stringify(state.logs)).not.toContain(TOKEN)
      expect(state.upsertCalls).toEqual([])
    },
  )
  it('uses the read RPC for lists, details and HEAD and refuses event mutations', async () => {
    const state = fake({ rpc: { api_handoff_acknowledgements: ok('{"data":[]}') } })
    expect((await route(state, 'GET', '?limit=2&cursor=abc')).status).toBe(200)
    expect(state.rpcCalls[0].args).toMatchObject({ p_limit: 2, p_after: 'abc', p_event_id: null })
    expect((await route(state, 'GET', `/${event}`)).status).toBe(200)
    expect(state.rpcCalls[1].args.p_event_id).toBe(event)
    expect(await (await route(state, 'HEAD')).text()).toBe('')
    for (const method of ['PUT', 'PATCH', 'DELETE'] as const)
      expect((await route(state, method)).status).toBe(405)
    expect((await route(state, 'POST', `/${event}`, JSON.stringify(value))).status).toBe(405)
    expect((await route(state, 'OPTIONS')).headers.get('allow')).toBe('GET, HEAD, POST, OPTIONS')
  })
  it.each([
    ['{', 400],
    [JSON.stringify({ ...value, status: 'rejected' }), 422],
    ['x'.repeat(8193), 413],
  ])('validates writes after authenticating (%s)', async (payload, status) => {
    const valid = fake({ rpc: { api_organization: ok(organizationText()) } })
    expect((await route(valid, 'POST', '', payload)).status).toBe(status)
    expect(valid.rpcCalls.map((call) => call.name)).toEqual(['api_organization'])
    const readOnly = fake({
      rpc: { api_organization: ok(organizationText(['purchase_handoffs:read'])) },
    })
    expect((await route(readOnly, 'POST', '', payload)).status).toBe(403)
    const expired = fake({ rpc: { api_organization: rpcError('MQ401', 'expired') } })
    expect((await route(expired, 'POST', '', payload)).status).toBe(401)
  })
  it('refuses unsupported media, cookies, invalid queries and conflicting events safely', async () => {
    const state = fake({
      rpc: {
        api_organization: ok(organizationText()),
        api_handoff_acknowledge: rpcError('MQ409', 'acknowledgement_conflict'),
      },
    })
    expect(
      (
        await route(state, 'POST', '', JSON.stringify(value), {
          ...JSON_HEADERS,
          'content-type': 'text/plain',
        })
      ).status,
    ).toBe(415)
    expect((await route(state, 'POST', '?limit=1', JSON.stringify(value))).status).toBe(400)
    expect((await route(state, 'GET', '?created_since=2026-10-01T00:00:00Z')).status).toBe(400)
    const conflict = await route(state, 'POST', '', JSON.stringify(value))
    expect(conflict.status).toBe(409)
    expect(conflict.headers.get('retry-after')).toBeNull()
    const error = await conflict.text()
    expect(error).toContain('acknowledgement_conflict')
    expect(error).not.toContain(LEAK)
    const anonymous = fake()
    const response = await handleResourceDetail(
      request(base, {
        method: 'POST',
        body: JSON.stringify(value),
        headers: { cookie: 'session=ignored', 'content-type': 'application/json' },
      }),
      'POST',
      'purchase-handoffs',
      [id, 'acknowledgements'],
      anonymous.deps,
    )
    expect(response.status).toBe(401)
    expect(anonymous.rpcCalls).toEqual([])
  })
})

describe.each(['purchase', 'transfer'] as const)('read-only %s handoff routes', (kind) => {
  const listRpc = kind === 'transfer' ? 'api_transfer_handoff_list' : 'api_handoff_list'
  const getRpc = kind === 'transfer' ? 'api_transfer_handoff_get' : 'api_handoff_get'
  const id = '98000000-0000-4000-8000-000000000001'
  it.each([`${kind}-handoffs`, `${kind}-handoff-batches`])(
    'passes list arguments and original detail JSON for %s',
    async (resource) => {
      const raw =
        '{"data":{"payload":{"subtotal":"999999999999999.999"},"current":{"selected":false}}}'
      const state = fake({ rpc: { [listRpc]: ok('{"data":[]}'), [getRpc]: ok(raw) } })
      const list = await handleResource(
        request(`/${resource}?limit=2&created_since=2026-10-01T00:00:00Z&cursor=abc`, {
          headers: AUTH,
        }),
        'GET',
        resource,
        state.deps,
      )
      expect(list.status).toBe(200)
      expect(state.rpcCalls[0]).toEqual({
        name: listRpc,
        args: {
          p_key_hash: HASH,
          p_resource: resource,
          p_limit: 2,
          p_after: 'abc',
          p_created_since: '2026-10-01T00:00:00Z',
        },
      })
      const detail = await handleResourceDetail(
        request(`/${resource}/${id}`, { headers: AUTH }),
        'GET',
        resource,
        [id],
        state.deps,
      )
      expect(detail.status).toBe(200)
      expect(await detail.text()).toBe(raw)
      expect(detail.headers.get('cache-control')).toContain('no-store')
      expect(detail.headers.get('set-cookie')).toBeNull()
      expect(state.rpcCalls[1]).toEqual({
        name: getRpc,
        args: { p_key_hash: HASH, p_resource: resource, p_id: id },
      })
      expect(state.upsertCalls).toEqual([])
      const head = await handleResourceDetail(
        request(`/${resource}/${id}`, { method: 'HEAD', headers: AUTH }),
        'HEAD',
        resource,
        [id],
        state.deps,
      )
      expect(head.status).toBe(200)
      expect(await head.text()).toBe('')
    },
  )
  it('authenticates before reporting malformed query or ID', async () => {
    for (const scopes of [[], [`${kind}_handoffs:read`]]) {
      const state = fake({ rpc: { api_organization: ok(organizationText(scopes)) } })
      const response = await handleResourceDetail(
        request(`/${kind}-handoffs/bad`, { headers: AUTH }),
        'GET',
        `${kind}-handoffs`,
        ['bad'],
        state.deps,
      )
      expect(response.status).toBe(scopes.length ? 400 : 403)
      expect((await body(response)).code).toBe(
        scopes.length ? 'invalid_parameter' : 'insufficient_scope',
      )
      expect(state.rpcCalls.map((call) => call.name)).toEqual(['api_organization'])
    }
    const expired = fake({ rpc: { api_organization: rpcError('MQ401', 'expired') } })
    expect(
      (
        await handleResource(
          request(`/${kind}-handoffs?limit=0`, { headers: AUTH }),
          'GET',
          `${kind}-handoffs`,
          expired.deps,
        )
      ).status,
    ).toBe(401)
    const signedIn = fake()
    expect(
      (
        await handleResource(
          request(`/${kind}-handoffs`, { headers: { cookie: 'session=ignored' } }),
          'GET',
          `${kind}-handoffs`,
          signedIn.deps,
        )
      ).status,
    ).toBe(401)
    expect(signedIn.rpcCalls).toEqual([])
  })
  it('rejects parameters on details, exposes no mutation routes and preserves nested 404s', async () => {
    const state = fake({ rpc: { api_organization: ok(organizationText()) } })
    expect(
      (
        await handleResourceDetail(
          request(`/${kind}-handoffs/${id}?payload=1`, { headers: AUTH }),
          'GET',
          `${kind}-handoffs`,
          [id],
          state.deps,
        )
      ).status,
    ).toBe(400)
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      const result = await handleResourceDetail(
        request(`/${kind}-handoffs/${id}`, { method, headers: AUTH }),
        method,
        `${kind}-handoffs`,
        [id],
        state.deps,
      )
      expect(result.status).toBe(405)
      expect(result.headers.get('allow')).toBe('GET, HEAD')
    }
    expect(
      (await handleResourceDetail(request('/items/x'), 'GET', 'items', ['x'], state.deps)).status,
    ).toBe(404)
    expect(
      (
        await handleResourceDetail(
          request(`/${kind}-handoffs/x/json`),
          'GET',
          `${kind}-handoffs`,
          ['x', 'json'],
          state.deps,
        )
      ).status,
    ).toBe(404)
    expect(state.rpcCalls).toHaveLength(1)
    expect(state.upsertCalls).toEqual([])
  })
  it('maps missing, wrong-scope and cursor RPC failures without leaking database details', async () => {
    for (const [code, hint, status] of [
      ['MQ404', 'resource', 404],
      ['MQ403', 'scope', 403],
      ['MQ422', 'cursor', 400],
    ] as const) {
      const state = fake({ rpc: { [listRpc]: rpcError(code, hint) } })
      const result = await handleResource(
        request(`/${kind}-handoffs`, { headers: AUTH }),
        'GET',
        `${kind}-handoffs`,
        state.deps,
      )
      expect(result.status).toBe(status)
      expect(await result.text()).not.toContain(LEAK)
    }
  })
})

const ITEM = {
  item_code: 'FAL-BRK-1001',
  name_en: 'Front brake pad set',
  brand_code: 'FALCON',
  unit_of_measure: 'SET',
}

function succeeded(records = 1): string {
  return JSON.stringify({
    result: 'succeeded',
    import_id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
    recorded: true,
    entity: 'items',
    records,
    counts: { inserted: records, updated: 0, unchanged: 0, deleted: 0, skipped: 0 },
    warning_count: 0,
    warnings: [],
    warnings_truncated: false,
  })
}

/* ------------------------------------------------------------------------------------------ */
/* Helpers                                                                                      */
/* ------------------------------------------------------------------------------------------ */

describe('request helpers', () => {
  it('accepts JSON media types only, with a UTF-8 charset if any', () => {
    expect(isJsonMediaType('application/json')).toBe(true)
    expect(isJsonMediaType('Application/JSON; charset=UTF-8')).toBe(true)
    expect(isJsonMediaType('application/json;charset="utf-8"')).toBe(true)
    expect(isJsonMediaType('application/problem+json')).toBe(true)
    expect(isJsonMediaType(null)).toBe(false)
    expect(isJsonMediaType('')).toBe(false)
    expect(isJsonMediaType('text/csv')).toBe(false)
    expect(isJsonMediaType('text/json')).toBe(false)
    expect(isJsonMediaType('application/jsonx')).toBe(false)
    expect(isJsonMediaType('application/json; charset=iso-8859-1')).toBe(false)
  })

  it('refuses every Content-Encoding but identity', () => {
    expect(hasContentEncoding(null)).toBe(false)
    expect(hasContentEncoding('')).toBe(false)
    expect(hasContentEncoding('identity')).toBe(false)
    expect(hasContentEncoding('gzip')).toBe(true)
    expect(hasContentEncoding('identity, br')).toBe(true)
  })

  it('lists every query parameter of an endpoint that takes none, once', () => {
    expect(noParameters(new URLSearchParams(''))).toBeNull()
    expect(noParameters(new URLSearchParams('a=1&a=2&b='))).toEqual({
      ok: false,
      code: 'invalid_parameter',
      errors: [
        { parameter: 'a', detail: 'Unknown parameter; this endpoint takes none.' },
        { parameter: 'b', detail: 'Unknown parameter; this endpoint takes none.' },
      ],
    })
  })

  it('compares If-None-Match weakly', () => {
    expect(ifNoneMatchHits(null, '"a"')).toBe(false)
    expect(ifNoneMatchHits('"a"', '"a"')).toBe(true)
    expect(ifNoneMatchHits('W/"a"', '"a"')).toBe(true)
    expect(ifNoneMatchHits('"b", W/"a"', '"a"')).toBe(true)
    expect(ifNoneMatchHits('*', '"a"')).toBe(true)
    expect(ifNoneMatchHits('"b"', '"a"')).toBe(false)
    expect(ifNoneMatchHits('a', '"a"')).toBe(false)
  })
})

/* ------------------------------------------------------------------------------------------ */
/* Routing                                                                                      */
/* ------------------------------------------------------------------------------------------ */

describe('routing', () => {
  it('answers unknown resources and deeper paths with a 404 problem, before anything else', async () => {
    for (const segment of ['nope', 'items:delete', 'organization:upsert', 'items%3', 'Items']) {
      const state = fake()
      const response = await handleResource(request(`/${segment}`), 'GET', segment, state.deps)
      expect(response.status).toBe(404)
      expect(response.headers.get('content-type')).toBe('application/problem+json')
      expect((await body(response)).code).toBe('not_found')
      expect(state.platformCalls).toBe(0)
      expect(state.rpcCalls).toEqual([])
    }
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const) {
      const state = fake()
      const response = notFound(request('/items/x/y', { method }), method, state.deps)
      expect(response.status).toBe(404)
      expect(response.headers.get('x-request-id')).toBe(REQUEST_ID)
      expect(response.headers.get('cache-control')).toBe('no-store')
      if (method === 'HEAD') expect(response.body).toBeNull()
      else expect((await body(response)).code).toBe('not_found')
      expect(only(state.logs)).toMatchObject({ operation: 'not_found', status: 404 })
    }
  })

  it('answers wrong methods with a 405 problem and the path’s Allow', async () => {
    const cases: [string, ApiMethod, string, string][] = [
      ['items', 'POST', 'GET, HEAD', 'Upserts use POST /api/v1/items:upsert.'],
      ['items', 'PUT', 'GET, HEAD', '/api/v1/items answers GET, HEAD only.'],
      ['items', 'PATCH', 'GET, HEAD', '/api/v1/items answers GET, HEAD only.'],
      ['items', 'DELETE', 'GET, HEAD', '/api/v1/items answers GET, HEAD only.'],
      ['items:upsert', 'GET', 'POST', 'Lists use GET /api/v1/items.'],
      ['items:upsert', 'HEAD', 'POST', 'Lists use GET /api/v1/items.'],
      ['items:upsert', 'PUT', 'POST', '/api/v1/items:upsert answers POST only.'],
      [
        'demand-history:upsert',
        'DELETE',
        'POST',
        '/api/v1/demand-history:upsert answers POST only.',
      ],
    ]
    for (const [segment, method, allow, detail] of cases) {
      const state = fake()
      const response = await handleResource(
        request(`/${segment}`, { method, headers: AUTH }),
        method,
        segment,
        state.deps,
      )
      expect(response.status).toBe(405)
      expect(response.headers.get('allow')).toBe(allow)
      expect(state.rpcCalls).toEqual([])
      if (method === 'HEAD') {
        expect(response.body).toBeNull()
        continue
      }
      const problem = await body(response)
      expect(problem).toMatchObject({
        type: 'urn:maqdar:problem:method_not_allowed',
        status: 405,
        code: 'method_not_allowed',
        detail,
        request_id: REQUEST_ID,
        instance: `urn:uuid:${REQUEST_ID}`,
      })
    }
  })

  it('answers OPTIONS with 204 and the path’s Allow, without CORS', async () => {
    for (const [segment, allow] of [
      ['items', 'GET, HEAD, OPTIONS'],
      ['items:upsert', 'POST, OPTIONS'],
    ]) {
      const state = fake()
      const response = await handleResource(
        request(`/${segment}`, {
          method: 'OPTIONS',
          headers: { origin: 'https://evil.test', 'access-control-request-method': 'POST' },
        }),
        'OPTIONS',
        segment as string,
        state.deps,
      )
      expect(response.status).toBe(204)
      expect(response.body).toBeNull()
      expect(response.headers.get('allow')).toBe(allow)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(
        [...response.headers.keys()].filter((name) => name.startsWith('access-control')),
      ).toEqual([])
      expect(state.platformCalls).toBe(0)
    }
  })

  it('takes a percent-escaped colon like the colon', async () => {
    const state = fake({ upsert: ok(succeeded()) })
    const response = await handleResource(
      request('/items%3Aupsert', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ records: [ITEM] }),
      }),
      'POST',
      'items%3Aupsert',
      state.deps,
    )
    expect(response.status).toBe(200)
    expect(only(state.upsertCalls).entity).toBe('items')
  })
})

/* ------------------------------------------------------------------------------------------ */
/* Index                                                                                        */
/* ------------------------------------------------------------------------------------------ */

describe('GET /api/v1', () => {
  it('points to the OpenAPI document and the docs without a key', async () => {
    const state = fake()
    const response = await handleIndex(request(''), 'GET', state.deps)
    expect(response.status).toBe(200)
    expect(await body(response)).toEqual({ openapi: OPENAPI_PATH, docs: API_DOCS_URL })
    expect(INDEX_BODY.openapi).toBe('/api/v1/openapi.json')
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-request-id')).toBe(REQUEST_ID)
    expect(response.headers.get('server-timing')).toBe('total;dur=10.0')
    expect(state.platformCalls).toBe(0)
    expect(only(state.logs)).toMatchObject({ operation: 'index', status: 200, method: 'GET' })
  })

  it('answers HEAD without a body, OPTIONS with 204 and other methods with 405', async () => {
    const head = await handleIndex(request('', { method: 'HEAD' }), 'HEAD', fake().deps)
    expect(head.status).toBe(200)
    expect(head.body).toBeNull()
    expect(head.headers.get('content-type')).toBe('application/json; charset=utf-8')

    const options = await handleIndex(request('', { method: 'OPTIONS' }), 'OPTIONS', fake().deps)
    expect(options.status).toBe(204)
    expect(options.headers.get('allow')).toBe('GET, HEAD, OPTIONS')

    const post = await handleIndex(request('', { method: 'POST' }), 'POST', fake().deps)
    expect(post.status).toBe(405)
    expect(post.headers.get('allow')).toBe('GET, HEAD')
  })
})

/* ------------------------------------------------------------------------------------------ */
/* Authentication and limits                                                                    */
/* ------------------------------------------------------------------------------------------ */

describe('authentication', () => {
  it('answers a missing credential with 401 unauthorized and no database call', async () => {
    const variants: Record<string, string>[] = [
      {},
      { authorization: 'Basic dXNlcjpwYXNz' },
      { authorization: '' },
    ]
    for (const headers of variants) {
      const state = fake()
      const response = await handleOrganization(
        request(`/organization?api_key=${TOKEN}`, { headers }),
        'GET',
        state.deps,
      )
      expect(response.status).toBe(401)
      expect(response.headers.get('www-authenticate')).toBe('Bearer realm="maqdar-api"')
      expect(response.headers.get('set-cookie')).toBeNull()
      expect((await body(response)).code).toBe('unauthorized')
      expect(state.rpcCalls).toEqual([])
    }
  })

  it('answers a malformed key or a bad checksum with 401 invalid_token offline', async () => {
    const badChecksum = `${TOKEN.slice(0, -1)}${TOKEN.endsWith('D') ? 'E' : 'D'}`
    for (const authorization of [
      'Bearer',
      'Bearer not-a-key',
      `Bearer ${badChecksum}`,
      `Bearer ${TOKEN}x`,
      `bearer ${TOKEN.slice(0, 20)}`,
    ]) {
      const state = fake()
      const response = await handleResource(
        request('/items', { headers: { authorization } }),
        'GET',
        'items',
        state.deps,
      )
      expect(response.status).toBe(401)
      expect(response.headers.get('www-authenticate')).toContain('error="invalid_token"')
      expect((await body(response)).code).toBe('invalid_token')
      expect(state.rpcCalls).toEqual([])
    }
  })

  it('accepts the bearer scheme in any case', async () => {
    const state = fake({ rpc: { api_organization: ok(organizationText()) } })
    const response = await handleOrganization(
      request('/organization', { headers: { authorization: `BEARER ${TOKEN}` } }),
      'GET',
      state.deps,
    )
    expect(response.status).toBe(200)
  })

  it('maps the database’s key refusals to 401 with their detail', async () => {
    for (const [hint, detail] of [
      ['api_key', 'The API key is not valid.'],
      ['revoked', 'The API key has been revoked.'],
      ['expired', 'The API key has expired.'],
      ['creator_inactive', 'no longer an owner or admin'],
    ] as const) {
      const state = fake({ rpc: { api_organization: rpcError('MQ401', hint) } })
      const response = await handleOrganization(
        request('/organization', { headers: AUTH }),
        'GET',
        state.deps,
      )
      expect(response.status).toBe(401)
      const problem = await body(response)
      expect(problem.code).toBe('invalid_token')
      expect(problem.detail).toContain(detail)
      expect(JSON.stringify(problem)).not.toContain(LEAK)
    }
  })
})

describe('rate limits', () => {
  it('checks the IP limiter before the credential and the key limiter after hashing', async () => {
    const state = fake({ rpc: { api_organization: ok(organizationText()) } })
    state.deps = {
      ...state.deps,
      platform: () => ({
        ipLimiter: limiter(state, () => true),
        keyLimiter: limiter(state, () => true),
      }),
    }
    const response = await handleOrganization(
      request('/organization', { headers: { ...AUTH, 'cf-connecting-ip': '203.0.113.9' } }),
      'GET',
      state.deps,
    )
    expect(response.status).toBe(200)
    expect(state.limiterKeys).toEqual(['ip:203.0.113.9', `key:${HASH.slice(2, 18)}`])
  })

  it('refuses with 429 before authenticating when the IP limiter says so', async () => {
    const state = fake()
    state.deps = {
      ...state.deps,
      platform: () => ({ ipLimiter: limiter(state, () => false), keyLimiter: null }),
    }
    const response = await handleOrganization(
      request('/organization', { headers: { 'cf-connecting-ip': '203.0.113.9' } }),
      'GET',
      state.deps,
    )
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    expect((await body(response)).code).toBe('rate_limited')
    expect(state.rpcCalls).toEqual([])
  })

  it('refuses with 429 and no database call when the key limiter says so', async () => {
    const state = fake()
    state.deps = {
      ...state.deps,
      platform: () => ({ ipLimiter: null, keyLimiter: limiter(state, () => false) }),
    }
    const response = await handleResource(
      request('/items', { headers: AUTH }),
      'GET',
      'items',
      state.deps,
    )
    expect(response.status).toBe(429)
    expect(state.rpcCalls).toEqual([])
    expect(only(state.logs)).toMatchObject({
      status: 429,
      code: 'rate_limited',
      key: HASH.slice(2, 10),
    })
  })

  it('skips the IP limiter without cf-connecting-ip and fails open when a binding throws', async () => {
    const state = fake({ rpc: { api_organization: ok(organizationText()) } })
    const warnings: unknown[] = []
    const original = console.warn
    console.warn = (...args: unknown[]) => warnings.push(args)
    try {
      state.deps = {
        ...state.deps,
        platform: () => ({
          ipLimiter: limiter(state, () => false),
          keyLimiter: {
            limit: async () => {
              throw new Error('binding down')
            },
          },
        }),
      }
      const response = await handleOrganization(
        request('/organization', { headers: AUTH }),
        'GET',
        state.deps,
      )
      expect(response.status).toBe(200)
      expect(state.limiterKeys).toEqual([])
      expect(warnings).toHaveLength(1)
    } finally {
      console.warn = original
    }
  })
})

/* ------------------------------------------------------------------------------------------ */
/* Organization                                                                                 */
/* ------------------------------------------------------------------------------------------ */

describe('GET /api/v1/organization', () => {
  it('passes the result through untouched with the common headers', async () => {
    const text = organizationText()
    const state = fake({ rpc: { api_organization: ok(text, 12.34) } })
    const response = await handleOrganization(
      request('/organization', { headers: AUTH }),
      'GET',
      state.deps,
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(text)
    expect(only(state.rpcCalls)).toEqual({ name: 'api_organization', args: { p_key_hash: HASH } })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-request-id')).toBe(REQUEST_ID)
    expect(response.headers.get('server-timing')).toBe('db;dur=12.3, total;dur=10.0')
    expect(response.headers.get('deprecation')).toBeNull()
    expect(only(state.logs)).toMatchObject({
      msg: 'api',
      request_id: REQUEST_ID,
      method: 'GET',
      operation: 'organization',
      status: 200,
      code: null,
      key: HASH.slice(2, 10),
      db_ms: 12.3,
    })
  })

  it('answers HEAD like GET without the body', async () => {
    const state = fake({ rpc: { api_organization: ok(organizationText()) } })
    const response = await handleOrganization(
      request('/organization', { method: 'HEAD', headers: AUTH }),
      'HEAD',
      state.deps,
    )
    expect(response.status).toBe(200)
    expect(response.body).toBeNull()
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(state.rpcCalls).toHaveLength(1)
  })

  it('refuses query parameters only after confirming the key', async () => {
    const state = fake({ rpc: { api_organization: ok(organizationText(['master_data:read'])) } })
    const response = await handleOrganization(
      request('/organization?expand=1', { headers: AUTH }),
      'GET',
      state.deps,
    )
    expect(response.status).toBe(400)
    expect(await body(response)).toMatchObject({
      code: 'invalid_parameter',
      errors: [{ parameter: 'expand' }],
    })
    expect(state.rpcCalls.map((call) => call.name)).toEqual(['api_organization'])

    const revoked = fake({ rpc: { api_organization: rpcError('MQ401', 'revoked') } })
    const refused = await handleOrganization(
      request('/organization?expand=1', { headers: AUTH }),
      'GET',
      revoked.deps,
    )
    expect(refused.status).toBe(401)
  })

  it('answers other methods with 405 and OPTIONS with 204', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      const state = fake()
      const response = await handleOrganization(
        request('/organization', { method, headers: AUTH }),
        method,
        state.deps,
      )
      expect(response.status).toBe(405)
      expect(response.headers.get('allow')).toBe('GET, HEAD')
      expect(state.rpcCalls).toEqual([])
    }
    const options = await handleOrganization(
      request('/organization', { method: 'OPTIONS' }),
      'OPTIONS',
      fake().deps,
    )
    expect(options.status).toBe(204)
    expect(options.headers.get('allow')).toBe('GET, HEAD, OPTIONS')
  })
})

/* ------------------------------------------------------------------------------------------ */
/* Lists                                                                                        */
/* ------------------------------------------------------------------------------------------ */

describe('GET /api/v1/{resource}', () => {
  const PAGE =
    '{"data":[{"item_code":"A","unit_cost":"12.50000000000000000001"}],"next_cursor":null,"as_of":"x"}'

  it('calls api_list with the checked query and passes the page through', async () => {
    const state = fake({ rpc: { api_list: ok(PAGE) } })
    const response = await handleResource(
      request('/items?limit=2&cursor=abc_-9&updated_since=2026-10-01T00:00:00Z', { headers: AUTH }),
      'GET',
      'items',
      state.deps,
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(PAGE)
    expect(only(state.rpcCalls)).toEqual({
      name: 'api_list',
      args: {
        p_key_hash: HASH,
        p_entity: 'items',
        p_limit: 2,
        p_after: 'abc_-9',
        p_updated_since: '2026-10-01T00:00:00Z',
      },
    })
    expect(only(state.logs)).toMatchObject({ operation: 'list:items', status: 200 })
  })

  it('calls api_list_demand for demand history', async () => {
    const state = fake({ rpc: { api_list_demand: ok(PAGE) } })
    const response = await handleResource(
      request('/demand-history?from=2026-01-01&to=2026-12-31&item_code=FAL-BRK-1001', {
        headers: AUTH,
      }),
      'GET',
      'demand-history',
      state.deps,
    )
    expect(response.status).toBe(200)
    expect(only(state.rpcCalls)).toEqual({
      name: 'api_list_demand',
      args: {
        p_key_hash: HASH,
        p_from: '2026-01-01',
        p_to: '2026-12-31',
        p_item_code: 'FAL-BRK-1001',
        p_location_code: null,
        p_limit: 1000,
        p_after: null,
      },
    })
    expect(only(state.logs).operation).toBe('list:demand_history')
  })

  it('answers HEAD like GET without the body', async () => {
    const state = fake({ rpc: { api_list: ok(PAGE) } })
    const response = await handleResource(
      request('/items', { method: 'HEAD', headers: AUTH }),
      'HEAD',
      'items',
      state.deps,
    )
    expect(response.status).toBe(200)
    expect(response.body).toBeNull()
    expect(state.rpcCalls).toHaveLength(1)
  })

  it('confirms the key and its scope before answering a bad query (J8)', async () => {
    const good = fake({ rpc: { api_organization: ok(organizationText(['master_data:read'])) } })
    const bad = await handleResource(
      request('/items?limit=0&color=red', { headers: AUTH }),
      'GET',
      'items',
      good.deps,
    )
    expect(bad.status).toBe(400)
    const problem = await body(bad)
    expect(problem.code).toBe('invalid_parameter')
    expect(problem.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ parameter: 'color' }),
        expect.objectContaining({ parameter: 'limit' }),
      ]),
    )
    expect(good.rpcCalls.map((call) => call.name)).toEqual(['api_organization'])

    const cursor = fake({ rpc: { api_organization: ok(organizationText()) } })
    const badCursor = await handleResource(
      request('/items?cursor=not%20base64', { headers: AUTH }),
      'GET',
      'items',
      cursor.deps,
    )
    expect(badCursor.status).toBe(400)
    expect((await body(badCursor)).code).toBe('invalid_cursor')

    const noScope = fake({ rpc: { api_organization: ok(organizationText(['transactions:read'])) } })
    const forbidden = await handleResource(
      request('/items?limit=0', { headers: AUTH }),
      'GET',
      'items',
      noScope.deps,
    )
    expect(forbidden.status).toBe(403)
    expect(forbidden.headers.get('www-authenticate')).toContain('scope="master_data:read"')
    expect(await body(forbidden)).toMatchObject({
      code: 'insufficient_scope',
      required_scope: 'master_data:read',
    })

    const unknown = fake({ rpc: { api_organization: rpcError('MQ401', 'api_key') } })
    const unauthorized = await handleResource(
      request('/demand-history', { headers: AUTH }),
      'GET',
      'demand-history',
      unknown.deps,
    )
    expect(unauthorized.status).toBe(401)
  })

  it('maps the list RPC’s errors', async () => {
    const cases: [ApiRpcResult, number, string][] = [
      [rpcError('MQ403', 'scope'), 403, 'insufficient_scope'],
      [rpcError('MQ422', 'cursor'), 400, 'invalid_cursor'],
      [rpcError('MQ422', 'limit'), 400, 'invalid_parameter'],
      [rpcError('57014'), 503, 'timeout'],
      [rpcError('fetch_failed', null, null, 0), 503, 'unavailable'],
      [rpcError('PGRST202', null, null, 404), 500, 'internal_error'],
    ]
    for (const [result, status, code] of cases) {
      const state = fake({ rpc: { api_list: result } })
      const response = await handleResource(
        request('/items', { headers: AUTH }),
        'GET',
        'items',
        state.deps,
      )
      expect(response.status).toBe(status)
      const text = await response.text()
      expect(JSON.parse(text).code).toBe(code)
      expect(text).not.toContain(LEAK)
    }
  })
})

/* ------------------------------------------------------------------------------------------ */
/* Upserts                                                                                      */
/* ------------------------------------------------------------------------------------------ */

function post(path: string, text: string, headers: Record<string, string> = JSON_HEADERS) {
  return request(path, { method: 'POST', headers, body: text })
}

describe('POST /api/v1/{resource}:upsert', () => {
  it('sends the body text unchanged and answers 200 with the request id', async () => {
    const text = `{ "records": [ {"item_code": "FAL-BRK-1001", "name_en": "Bolt", "unit_cost": 1.50,
      "currency": "SAR", "updated_at": "ignored"} ] }`
    const state = fake({ upsert: ok(succeeded(), 40) })
    const response = await handleResource(
      post('/items:upsert', text),
      'POST',
      'items:upsert',
      state.deps,
    )
    expect(response.status).toBe(200)
    expect(only(state.upsertCalls)).toEqual({
      keyHash: HASH,
      entity: 'items',
      bodyText: text,
      requestId: REQUEST_ID,
    })
    expect(state.rpcCalls).toEqual([])
    expect(await body(response)).toEqual({
      import_id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
      recorded: true,
      request_id: REQUEST_ID,
      resource: 'items',
      records: 1,
      counts: { inserted: 1, updated: 0, unchanged: 0, deleted: 0, skipped: 0 },
      warning_count: 0,
      warnings: [],
      warnings_truncated: false,
    })
    expect(response.headers.get('server-timing')).toBe('db;dur=40.0, total;dur=10.0')
    expect(only(state.logs)).toMatchObject({
      operation: 'upsert:items',
      status: 200,
      records: 1,
      db_ms: 40,
    })
  })

  it('keeps every digit: the spliced text is what the caller sent', async () => {
    const text =
      '{"records":[{"from_currency":"USD","to_currency":"SAR","valid_from":"2026-01-01","rate":3.75000000000000000001}]}'
    const state = fake({ upsert: ok(succeeded()) })
    const response = await handleResource(
      post('/fx-rates:upsert', text),
      'POST',
      'fx-rates:upsert',
      state.deps,
    )
    expect(response.status).toBe(200)
    expect(only(state.upsertCalls).bodyText).toContain('3.75000000000000000001')
  })

  it('maps invalid and conflict results', async () => {
    const invalid = fake({
      upsert: ok(
        JSON.stringify({
          result: 'invalid',
          failure_code: null,
          error_count: 1,
          error_counts: { invalid_decimal: { unit_cost: 1 } },
          errors: [
            {
              pointer: '#/records/0/unit_cost',
              record: 0,
              field: 'unit_cost',
              code: 'invalid_decimal',
              value: 'abc',
              detail: { sqlstate: '22P02', message: LEAK, phase: 'stage' },
            },
          ],
          errors_truncated: false,
          warning_count: 0,
          warnings: [],
          warnings_truncated: false,
        }),
      ),
    })
    const response = await handleResource(
      post('/items:upsert', JSON.stringify({ records: [ITEM] })),
      'POST',
      'items:upsert',
      invalid.deps,
    )
    expect(response.status).toBe(422)
    const text = await response.text()
    expect(JSON.parse(text)).toMatchObject({
      code: 'validation_failed',
      error_count: 1,
      errors: [{ pointer: '#/records/0/unit_cost', record: 0, field: 'unit_cost' }],
    })
    for (const leak of [LEAK, 'sqlstate', '"phase"', '"message"']) expect(text).not.toContain(leak)

    const conflict = fake({
      upsert: ok(
        JSON.stringify({
          result: 'conflict',
          failure_code: 'changed_during_commit',
          error_count: 1,
          error_counts: {},
          errors: [],
          errors_truncated: false,
        }),
      ),
    })
    const conflicted = await handleResource(
      post('/items:upsert', JSON.stringify({ records: [ITEM] })),
      'POST',
      'items:upsert',
      conflict.deps,
    )
    expect(conflicted.status).toBe(409)
    expect(conflicted.headers.get('retry-after')).toBe('2')
    expect(await body(conflicted)).toMatchObject({
      code: 'write_conflict',
      failure_code: 'changed_during_commit',
    })
  })

  it('maps the upsert RPC’s errors without leaking SQL', async () => {
    const cases: [ApiRpcResult, number, string, string | null][] = [
      [rpcError('MQ401', 'expired'), 401, 'invalid_token', null],
      [rpcError('MQ403', 'scope'), 403, 'insufficient_scope', null],
      [rpcError('MQ409', 'import_in_progress'), 409, 'import_in_progress', '5'],
      [rpcError('MQ409', 'another_commit'), 409, 'import_in_progress', '30'],
      [rpcError('40P01'), 409, 'busy', '2'],
      [rpcError('MQ429', 'api_writes_per_day'), 429, 'daily_limit', '3600'],
      [rpcError('22P05'), 400, 'invalid_json', null],
      [
        rpcError(
          'MQ422',
          'records',
          JSON.stringify({ code: 'invalid_type', record: 0, field: 'name_en' }),
        ),
        422,
        'invalid_request',
        null,
      ],
      [
        rpcError('MQ422', 'records', JSON.stringify({ code: 'too_many_records', limit: 1000 })),
        413,
        'too_many_records',
        null,
      ],
      [rpcError('57014'), 503, 'timeout', '5'],
      [rpcError('http_502', null, null, 502), 503, 'unavailable', '5'],
      [rpcError('MQ499'), 500, 'internal_error', null],
      [rpcError('42501'), 500, 'internal_error', null],
    ]
    for (const [result, status, code, retryAfter] of cases) {
      const state = fake({ upsert: result })
      const response = await handleResource(
        post('/items:upsert', JSON.stringify({ records: [ITEM] })),
        'POST',
        'items:upsert',
        state.deps,
      )
      expect(response.status, code).toBe(status)
      expect(response.headers.get('retry-after')).toBe(retryAfter)
      const text = await response.text()
      expect(JSON.parse(text).code).toBe(code)
      expect(text).not.toContain(LEAK)
      if (status >= 500) {
        const entry = only(state.errors)
        expect(entry.status).toBe(status)
        if (code === 'internal_error') {
          expect(entry.sqlstate).toBe((result as { error: { code: string } }).error.code)
          expect(entry).not.toHaveProperty('error')
          expect(JSON.stringify(entry)).not.toContain(LEAK)
        }
      } else {
        expect(state.errors).toEqual([])
        expect(only(state.logs).sqlstate).toBeUndefined()
      }
    }
  })

  it('answers 500 for an unreadable result', async () => {
    for (const text of ['not json', '[]', '{"result":"maybe"}']) {
      const state = fake({ upsert: ok(text) })
      const response = await handleResource(
        post('/items:upsert', JSON.stringify({ records: [ITEM] })),
        'POST',
        'items:upsert',
        state.deps,
      )
      expect(response.status).toBe(500)
      expect((await body(response)).code).toBe('internal_error')
      expect(only(state.errors)).toMatchObject({ status: 500, code: 'internal_error' })
      expect(only(state.errors)).not.toHaveProperty('error')
    }
  })

  type ShapeCase = {
    name: string
    path?: string
    headers?: Record<string, string>
    text: string
    status: number
    code: string
  }

  const SHAPE_CASES: ShapeCase[] = [
    {
      name: 'text/csv',
      headers: { ...AUTH, 'content-type': 'text/csv' },
      text: 'a,b',
      status: 415,
      code: 'unsupported_media_type',
    },
    {
      name: 'no content type',
      headers: AUTH,
      text: '{}',
      status: 415,
      code: 'unsupported_media_type',
    },
    {
      name: 'gzip',
      headers: { ...JSON_HEADERS, 'content-encoding': 'gzip' },
      text: '{}',
      status: 415,
      code: 'unsupported_media_type',
    },
    {
      name: 'query parameter',
      path: '/items:upsert?dry_run=1',
      text: '{}',
      status: 400,
      code: 'invalid_parameter',
    },
    { name: 'empty body', text: '', status: 400, code: 'invalid_json' },
    { name: 'invalid JSON', text: '{"records": [', status: 400, code: 'invalid_json' },
    { name: 'array body', text: '[]', status: 422, code: 'invalid_request' },
    { name: 'no records', text: '{"records": []}', status: 422, code: 'invalid_request' },
    {
      name: 'mixed fields',
      text: JSON.stringify({ records: [ITEM, { item_code: 'X-1', name_en: 'Y' }] }),
      status: 422,
      code: 'invalid_request',
    },
    {
      name: 'too many records',
      text: JSON.stringify({ records: Array.from({ length: recordCap('items') + 1 }, () => ITEM) }),
      status: 413,
      code: 'too_many_records',
    },
    {
      name: 'body over 1 MiB',
      text: JSON.stringify({ records: [{ ...ITEM, name_en: 'x'.repeat(1_048_576) }] }),
      status: 413,
      code: 'payload_too_large',
    },
  ]

  it('answers request-shape problems only after confirming the key (J8)', async () => {
    for (const shape of SHAPE_CASES) {
      const state = fake({ rpc: { api_organization: ok(organizationText()) } })
      const response = await handleResource(
        post(shape.path ?? '/items:upsert', shape.text, shape.headers),
        'POST',
        'items:upsert',
        state.deps,
      )
      expect(response.status, shape.name).toBe(shape.status)
      expect((await body(response)).code, shape.name).toBe(shape.code)
      expect(
        state.rpcCalls.map((call) => call.name),
        shape.name,
      ).toEqual(['api_organization'])
      expect(state.upsertCalls, shape.name).toEqual([])
    }
  })

  it('gives an invalid key 401 and a key without the scope 403, whatever the body', async () => {
    for (const shape of SHAPE_CASES) {
      const revoked = fake({ rpc: { api_organization: rpcError('MQ401', 'revoked') } })
      const unauthorized = await handleResource(
        post(shape.path ?? '/items:upsert', shape.text, shape.headers),
        'POST',
        'items:upsert',
        revoked.deps,
      )
      expect(unauthorized.status, shape.name).toBe(401)
      expect((await body(unauthorized)).detail).toBe('The API key has been revoked.')

      const readOnly = fake({
        rpc: { api_organization: ok(organizationText(['master_data:read'])) },
      })
      const forbidden = await handleResource(
        post(shape.path ?? '/items:upsert', shape.text, shape.headers),
        'POST',
        'items:upsert',
        readOnly.deps,
      )
      expect(forbidden.status, shape.name).toBe(403)
      expect(await body(forbidden)).toMatchObject({ required_scope: 'master_data:write' })
    }
  })

  it('needs transactions:write for demand history', async () => {
    const state = fake({ rpc: { api_organization: ok(organizationText(['master_data:write'])) } })
    const response = await handleResource(
      post('/demand-history:upsert', '{"records": 1}'),
      'POST',
      'demand-history:upsert',
      state.deps,
    )
    expect(response.status).toBe(403)
    expect(await body(response)).toMatchObject({ required_scope: 'transactions:write' })
  })

  it('lists the request-shape errors with pointers', async () => {
    const state = fake({ rpc: { api_organization: ok(organizationText()) } })
    const response = await handleResource(
      post(
        '/items:upsert',
        JSON.stringify({ records: [ITEM, { ...ITEM, name_en: 5 }], extra: true }),
      ),
      'POST',
      'items:upsert',
      state.deps,
    )
    expect(response.status).toBe(422)
    const problem = await body(response)
    expect(problem.code).toBe('invalid_request')
    expect(problem.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pointer: '#/extra', code: 'unknown_field' }),
        expect.objectContaining({ pointer: '#/records/1/name_en', code: 'invalid_type' }),
      ]),
    )
  })

  it('answers a failed key confirmation with its own problem', async () => {
    const state = fake({ rpc: { api_organization: rpcError('fetch_failed', null, null, 0) } })
    const response = await handleResource(
      post('/items:upsert', 'nope'),
      'POST',
      'items:upsert',
      state.deps,
    )
    expect(response.status).toBe(503)
    expect((await body(response)).code).toBe('unavailable')

    const garbled = fake({ rpc: { api_organization: ok('{"key": {}}') } })
    const failed = await handleResource(
      post('/items:upsert', 'nope'),
      'POST',
      'items:upsert',
      garbled.deps,
    )
    expect(failed.status).toBe(500)
    expect(only(garbled.errors)).toMatchObject({ status: 500, code: 'internal_error' })
    expect(only(garbled.errors)).not.toHaveProperty('error')
  })

  it('answers 500 with the request id when a dependency throws', async () => {
    const state = fake({
      upsert: () => {
        throw new TypeError('boom')
      },
    })
    const response = await handleResource(
      post('/items:upsert', JSON.stringify({ records: [ITEM] })),
      'POST',
      'items:upsert',
      state.deps,
    )
    expect(response.status).toBe(500)
    expect(await body(response)).toMatchObject({ code: 'internal_error', request_id: REQUEST_ID })
    expect(only(state.errors)).toMatchObject({ status: 500, code: 'internal_error' })
    expect(only(state.errors)).not.toHaveProperty('error')
    expect(JSON.stringify(state.errors)).not.toContain('boom')
  })
})

/* ------------------------------------------------------------------------------------------ */
/* Logging                                                                                      */
/* ------------------------------------------------------------------------------------------ */

describe('log line', () => {
  it('writes one line per request without the key, the header or values', async () => {
    const state = fake({ upsert: ok(succeeded()) })
    await handleResource(
      post('/items:upsert', JSON.stringify({ records: [{ ...ITEM, name_en: 'Sekrit Bolt' }] }), {
        ...JSON_HEADERS,
        'cf-ray': '8d2f1a3b4c5d6e7f-RUH',
      }),
      'POST',
      'items:upsert',
      state.deps,
    )
    const entry = only(state.logs)
    expect(entry).toEqual({
      msg: 'api',
      request_id: REQUEST_ID,
      cf_ray: '8d2f1a3b4c5d6e7f-RUH',
      method: 'POST',
      operation: 'upsert:items',
      status: 200,
      code: null,
      key: HASH.slice(2, 10),
      records: 1,
      db_ms: 5,
      total_ms: 10,
    })
    const logged = JSON.stringify(entry)
    for (const secret of [TOKEN, HASH.slice(2), 'Sekrit', 'Bearer']) {
      expect(logged).not.toContain(secret)
    }
  })
})

/* ------------------------------------------------------------------------------------------ */
/* OpenAPI document                                                                             */
/* ------------------------------------------------------------------------------------------ */

describe('GET /api/v1/openapi.json', () => {
  const committed = readFileSync(join(__dirname, 'openapi.json'), 'utf8')

  it('re-serializing the imported JSON gives the committed file byte for byte', () => {
    expect(`${JSON.stringify(JSON.parse(committed), null, 2)}\n`).toBe(committed)
  })

  it('computes the text and its ETag once', async () => {
    let calls = 0
    const source = openApiSource(() => {
      calls += 1
      return committed
    })
    const [a, b] = await Promise.all([source(), source()])
    expect(a).toBe(b)
    expect(calls).toBe(1)
    expect(a.etag).toBe(await strongEtag(committed))
    expect(a.etag).toMatch(/^"[0-9a-f]{64}"$/)
  })

  it('does not cache a failure', async () => {
    let calls = 0
    const source = openApiSource(() => {
      calls += 1
      if (calls === 1) throw new Error('first')
      return '{}\n'
    })
    await expect(source()).rejects.toThrow('first')
    await expect(source()).resolves.toMatchObject({ text: '{}\n' })
  })

  it('serves the document publicly with a strong ETag and 304', async () => {
    const source = openApiSource(() => committed)
    const etag = await strongEtag(committed)
    const state = fake()
    const response = await handleOpenApi(request('/openapi.json'), 'GET', source, state.deps)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(committed)
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'access-control-allow-origin': '*',
      'cache-control': OPENAPI_CACHE_CONTROL,
      'content-type': 'application/json; charset=utf-8',
      etag,
      'x-request-id': REQUEST_ID,
    })
    expect(state.platformCalls).toBe(0)
    expect(only(state.logs)).toMatchObject({ operation: 'openapi', status: 200 })

    for (const ifNoneMatch of [etag, `W/${etag}`, `"other", ${etag}`, '*']) {
      const cached = await handleOpenApi(
        request('/openapi.json', { headers: { 'if-none-match': ifNoneMatch } }),
        'GET',
        source,
        fake().deps,
      )
      expect(cached.status).toBe(304)
      expect(cached.body).toBeNull()
      expect(cached.headers.get('etag')).toBe(etag)
      expect(cached.headers.get('cache-control')).toBe(OPENAPI_CACHE_CONTROL)
      expect(cached.headers.get('access-control-allow-origin')).toBe('*')
    }

    const stale = await handleOpenApi(
      request('/openapi.json', { headers: { 'if-none-match': '"stale"' } }),
      'GET',
      source,
      fake().deps,
    )
    expect(stale.status).toBe(200)

    const head = await handleOpenApi(
      request('/openapi.json', { method: 'HEAD' }),
      'HEAD',
      source,
      fake().deps,
    )
    expect(head.status).toBe(200)
    expect(head.body).toBeNull()
    expect(head.headers.get('etag')).toBe(etag)
  })

  it('answers OPTIONS with CORS and other methods with 405', async () => {
    const source = openApiSource(() => committed)
    const options = await handleOpenApi(
      request('/openapi.json', { method: 'OPTIONS' }),
      'OPTIONS',
      source,
      fake().deps,
    )
    expect(options.status).toBe(204)
    expect(options.headers.get('allow')).toBe('GET, HEAD, OPTIONS')
    expect(options.headers.get('access-control-allow-origin')).toBe('*')
    expect(options.headers.get('access-control-allow-methods')).toBe('GET, HEAD, OPTIONS')

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      const response = await handleOpenApi(
        request('/openapi.json', { method }),
        method,
        source,
        fake().deps,
      )
      expect(response.status).toBe(405)
      expect(response.headers.get('allow')).toBe('GET, HEAD')
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
  })
})

it.each(['transfer-handoffs', 'transfer-handoff-batches'])(
  'does not expose transfer acknowledgements on %s',
  async (resource) => {
    const state = fake()
    for (const method of ['GET', 'POST', 'OPTIONS'] as const) {
      expect(
        (
          await handleResourceDetail(
            request(`/${resource}/id/acknowledgements`, { headers: AUTH }),
            method,
            resource,
            ['id', 'acknowledgements'],
            state.deps,
          )
        ).status,
      ).toBe(404)
    }
    const preflight = await handleResource(request(`/${resource}`), 'OPTIONS', resource, state.deps)
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('allow')).toBe('GET, HEAD, OPTIONS')
    expect(state.rpcCalls).toEqual([])
  },
)
