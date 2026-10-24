import { expect, it, vi } from 'vitest'
import { handleResource, handleResourceDetail, type ApiDeps, type ApiMethod } from './handler'
import { API_SCOPES } from './auth'
import { returnBatchFixture } from '../dealer-return-batches.fixture'
import { returnBatchJson } from '../dealer-return-batches'
import { returnHandoffJson } from '../dealer-return-handoffs'
import { buildOpenApi } from './openapi'

const id = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b'
const token = 'zeespare_sk_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefg0QUuQI'
const resources = ['dealer-return-handoffs', 'dealer-return-handoff-batches']
const scope = 'dealer_return_handoffs:read'
function fixture(scopes: readonly string[] = [scope]) {
  const text = '{"data":{"payload":' + returnBatchJson(returnBatchFixture).trim() + '}}'
  const rpc = vi.fn(async (name: string) => ({
    ok: true as const,
    status: 200,
    ms: 1,
    text: name === 'api_organization' ? JSON.stringify({ key: { scopes } }) : text,
  }))
  const deps: ApiDeps = {
    rpc,
    upsert: vi.fn(),
    platform: () => ({ ipLimiter: null, keyLimiter: null }),
    requestId: () => id,
    logger: { log: vi.fn(), error: vi.fn() },
  }
  const call = (
    resource: string,
    method: ApiMethod = 'GET',
    rest: string[] = [],
    query = '',
    authenticated = true,
  ) => {
    const request = new Request(
      `https://example.test/api/v1/${resource}${rest.length ? '/' + rest.join('/') : ''}${query}`,
      {
        headers: authenticated
          ? { Authorization: `Bearer ${token}` }
          : { Cookie: 'session=ignored' },
      },
    )
    return rest.length
      ? handleResourceDetail(request, method, resource, rest, deps)
      : handleResource(request, method, resource, deps)
  }
  return { rpc, text, call }
}
it.each(resources)(
  'routes %s reads to its guarded RPC and preserves exact response bytes',
  async (resource) => {
    const { rpc, text, call } = fixture()
    const list = await call(resource, 'GET', [], '?limit=1')
    const detail = await call(resource, 'GET', [id])
    expect(list.status).toBe(200)
    expect(await list.text()).toBe(text)
    expect(await detail.text()).toBe(text)
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'api_dealer_return_handoff_list',
      'api_dealer_return_handoff_get',
    ])
    expect(rpc.mock.calls[0]).toEqual([
      'api_dealer_return_handoff_list',
      expect.objectContaining({
        p_resource: resource,
        p_limit: 1,
        p_after: null,
        p_created_since: null,
      }),
    ])
    expect(detail.headers.get('cache-control')).toContain('no-store')
    expect(detail.headers.get('set-cookie')).toBeNull()
    expect((await call(resource, 'HEAD', [id])).status).toBe(200)
    expect(await (await call(resource, 'HEAD', [id])).text()).toBe('')
    expect((await call(resource, 'OPTIONS')).headers.get('allow')).toBe('GET, HEAD, OPTIONS')
  },
)
it.each(resources)('keeps %s package payloads read-only', async (resource) => {
  const { rpc, call } = fixture()
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
    expect((await call(resource, method)).status).toBe(405)
    expect((await call(resource, method, [id])).status).toBe(405)
  }
  expect(rpc).not.toHaveBeenCalled()
  expect((await call(resource, 'GET', [], '', false)).status).toBe(401)
  expect(rpc).not.toHaveBeenCalled()
})
it.each(resources)(
  'authorizes malformed %s requests before revealing validation',
  async (resource) => {
    const old = fixture(API_SCOPES.filter((s) => s !== scope))
    for (const [rest, query] of [
      [[], '?limit=101'],
      [['bad'], ''],
      [[id], '?extra=1'],
    ] as [string[], string][])
      expect((await old.call(resource, 'GET', rest, query)).status).toBe(403)
    expect(old.rpc.mock.calls.every(([name]) => name === 'api_organization')).toBe(true)
    const authorized = fixture()
    for (const query of [
      '?limit=0',
      '?limit=101',
      '?limit=1&limit=2',
      '?created_since=2026-10-24',
      '?cursor=***',
      '?unknown=1',
      '?limit=',
    ])
      expect((await authorized.call(resource, 'GET', [], query)).status).toBe(400)
    expect((await authorized.call(resource, 'GET', ['bad'])).status).toBe(400)
    expect((await authorized.call(resource, 'GET', [id], '?limit=1')).status).toBe(400)
    expect(authorized.rpc.mock.calls.every(([name]) => name === 'api_organization')).toBe(true)
  },
)
it('documents exact authorization payloads, source availability and only the explicit read scope', () => {
  const doc = buildOpenApi()
  for (const resource of resources) {
    expect(doc.paths[`/${resource}`].get['x-zeespare-scopes']).toEqual([scope])
    expect(doc.paths[`/${resource}/{id}`].get['x-zeespare-scopes']).toEqual([scope])
    expect(doc.paths[`/${resource}/{id}/acknowledgements`].post['x-zeespare-scopes']).toEqual([
      'dealer_return_handoffs:acknowledge',
    ])
    expect(doc.paths[`/${resource}`].post).toBeUndefined()
  }
  const schemas = doc.components.schemas
  expect(JSON.stringify(schemas.DealerReturnHandoffPayload)).toContain('eligibility_confirmed')
  expect(JSON.stringify(schemas.DealerReturnHandoffBatchPayload)).toContain(
    'dealer-return-batch-v1',
  )
  expect(schemas.DealerReturnHandoffSourceContext).toMatchObject({
    properties: { sources_available: { type: 'boolean' } },
  })
  expect(JSON.parse(returnBatchJson(returnBatchFixture)).lines[0]).toEqual(
    JSON.parse(returnHandoffJson(returnBatchFixture.lines[0])),
  )
})
