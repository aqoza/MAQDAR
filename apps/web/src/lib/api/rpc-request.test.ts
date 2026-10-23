import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { hashApiKey } from './keys'
import {
  API_RPC_NAMES,
  buildRpcRequest,
  executeRpc,
  isApiRpcName,
  rpcPayload,
  upsertPayload,
  type ApiRpcName,
  type FetchLike,
  type MissingApiRpcs,
  type UndeclaredRpcArgs,
} from './rpc-request'

const CONFIG = {
  supabaseUrl: 'http://127.0.0.1:54321/',
  secretKey: 'sb_secret_test_value_0123456789',
}

describe('buildRpcRequest (J9)', () => {
  it('sends the secret in apikey only, as JSON, never cached or redirected', () => {
    for (const name of API_RPC_NAMES) {
      const request = buildRpcRequest(name, '{}', CONFIG)
      expect(request.url).toBe(`http://127.0.0.1:54321/rest/v1/rpc/${name}`)
      expect(request.init.method).toBe('POST')
      expect(request.init.cache).toBe('no-store')
      expect(request.init.redirect).toBe('manual')
      expect(request.init.body).toBe('{}')
      const headers = new Headers(request.init.headers)
      expect(headers.get('apikey')).toBe(CONFIG.secretKey)
      expect(headers.get('authorization')).toBeNull()
      expect(headers.get('content-type')).toBe('application/json')
      expect(headers.get('accept')).toBe('application/json')
      expect([...headers.keys()].sort()).toEqual(['accept', 'apikey', 'content-type'])
      expect(JSON.stringify(request.init.headers).match(/sb_secret_/g)).toHaveLength(1)
    }
  })

  it('declares the arguments the generated function types have (checked by tsc)', () => {
    expectTypeOf<UndeclaredRpcArgs>().toBeNever()
    expectTypeOf<MissingApiRpcs>().toBeNever()
    // Declared operations must also be admitted by the runtime fetch allowlist.
    expectTypeOf<Exclude<ApiRpcName, (typeof API_RPC_NAMES)[number]>>().toBeNever()
  })

  it('admits api_* RPCs only', () => {
    expect(API_RPC_NAMES).toEqual([
      'api_excess_disposition_handoff_acknowledge',
      'api_excess_disposition_handoff_acknowledgements',
      'api_regional_handoff_acknowledge',
      'api_regional_handoff_acknowledgements',
      'api_network_handoff_acknowledge',
      'api_network_handoff_acknowledgements',
      'api_network_handoff_list',
      'api_network_handoff_get',
      'api_regional_handoff_list',
      'api_regional_handoff_get',
      'api_excess_disposition_handoff_list',
      'api_excess_disposition_handoff_get',
      'api_event_purchase_handoff_acknowledge',
      'api_event_purchase_handoff_acknowledgements',
      'api_event_purchase_handoff_list',
      'api_event_purchase_handoff_get',
      'api_transfer_handoff_acknowledge',
      'api_transfer_handoff_acknowledgements',
      'api_handoff_acknowledge',
      'api_handoff_acknowledgements',
      'api_handoff_list',
      'api_handoff_get',
      'api_transfer_handoff_list',
      'api_transfer_handoff_get',
      'api_organization',
      'api_list',
      'api_list_demand',
      'api_upsert',
    ])
    expect(isApiRpcName('api_upsert')).toBe(true)
    expect(isApiRpcName('import_commit_step')).toBe(false)
    expect(() =>
      buildRpcRequest('create_organization' as unknown as ApiRpcName, '{}', CONFIG),
    ).toThrow(/Not an api_\* RPC/)
  })
})

describe('payloads', () => {
  it('serializes plain arguments', async () => {
    const hash = await hashApiKey('maqdar_sk_x')
    expect(JSON.parse(rpcPayload<'api_organization'>({ p_key_hash: hash }))).toEqual({
      p_key_hash: hash,
    })
  })

  it('splices the upsert body as sent, keeping every digit', async () => {
    const hash = await hashApiKey('maqdar_sk_x')
    const bodyText =
      '{"records":[{"from_currency":"USD","to_currency":"SAR","valid_from":"2026-01-01","rate":3.75000000000000000001}]}'
    const payload = upsertPayload({
      keyHash: hash,
      entity: 'fx_rates',
      bodyText,
      requestId: '1e8f2e0a-58a5-4f0e-9a43-7b1d7d2c5a10',
    })
    expect(payload).toBe(
      `{"p_key_hash":${JSON.stringify(hash)},"p_entity":"fx_rates","p_body":${bodyText},"p_request_id":"1e8f2e0a-58a5-4f0e-9a43-7b1d7d2c5a10"}`,
    )
    expect(payload).toContain('3.75000000000000000001')
    expect(JSON.parse(payload).p_body.records[0].rate).toBe(3.75)
    expect(JSON.parse(payload).p_key_hash).toBe(hash)
  })
})

describe('executeRpc', () => {
  const request = buildRpcRequest('api_organization', '{}', CONFIG)
  const respond = (body: string, status = 200, contentType = 'application/json'): FetchLike =>
    vi.fn(async () => new Response(body, { status, headers: { 'content-type': contentType } }))

  it('passes successful results through as text', async () => {
    const fetchImpl = respond('{"data":[],"next_cursor":null}')
    const result = await executeRpc(request, fetchImpl)
    expect(result).toMatchObject({ ok: true, status: 200, text: '{"data":[],"next_cursor":null}' })
    expect(fetchImpl).toHaveBeenCalledWith(request.url, request.init)
  })

  it('reads PostgREST errors', async () => {
    const result = await executeRpc(
      request,
      respond('{"code":"MQ401","message":"invalid key","details":null,"hint":"revoked"}', 400),
    )
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: 'MQ401', message: 'invalid key', details: null, hint: 'revoked' },
    })
  })

  it('reports gateway pages and fetch failures with synthetic codes', async () => {
    expect(
      await executeRpc(request, respond('<html>Bad gateway</html>', 502, 'text/html')),
    ).toMatchObject({
      ok: false,
      status: 502,
      error: { code: 'http_502' },
    })
    const failing: FetchLike = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    expect(await executeRpc(request, failing)).toMatchObject({
      ok: false,
      status: 0,
      error: { code: 'fetch_failed', message: 'fetch failed' },
    })
  })

  it('measures the call', async () => {
    let clock = 100
    const now = () => (clock += 7)
    const result = await executeRpc(request, respond('{}'), now)
    expect(result.ms).toBe(7)
  })
})
