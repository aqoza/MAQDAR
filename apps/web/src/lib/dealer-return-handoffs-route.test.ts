import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { returnHandoffFixture } from './dealer-return-handoffs.fixture'
import { returnHandoffJson, returnHandoffCsv } from './dealer-return-handoffs'
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  context: vi.fn(),
  from: vi.fn(),
  eq: vi.fn(),
  single: vi.fn(),
}))
vi.mock('@/lib/organizations/context', () => ({ getActiveContext: mocks.context }))
vi.mock('@/lib/imports/route-auth', () => ({ requireSessionRoute: mocks.session }))
vi.mock('@/lib/imports/route', () => import('./imports/route'))
vi.mock('@/lib/dealer-return-handoffs', () => import('./dealer-return-handoffs'))
import { GET } from '../app/api/dealer-return-handoffs/[handoffId]/[format]/route'
const id = returnHandoffFixture.handoff_id
function request(format = 'json', handoffId = id) {
  return GET(
    new NextRequest(`http://localhost/api/dealer-return-handoffs/${handoffId}/${format}`),
    {
      params: Promise.resolve({ handoffId, format }),
    },
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  const query = { select: () => query, eq: mocks.eq, maybeSingle: mocks.single }
  mocks.eq.mockReturnValue(query)
  mocks.from.mockReturnValue(query)
  mocks.session.mockResolvedValue({ ok: true, supabase: { from: mocks.from } })
  mocks.context.mockResolvedValue({ active: { id: 'session-org' }, role: 'viewer' })
  mocks.single.mockResolvedValue({ data: { payload: returnHandoffFixture }, error: null })
})
it.each(['csv', 'json'])(
  'allows authorized members to download deterministic %s attachments',
  async (format) => {
    const result = await request(format)
    expect(result.status).toBe(200)
    expect(mocks.eq).toHaveBeenCalledWith('organization_id', 'session-org')
    expect(mocks.eq).toHaveBeenCalledWith('id', id)
    expect(result.headers.get('cache-control')).toBe('private, no-store')
    expect(result.headers.get('x-content-type-options')).toBe('nosniff')
    expect(result.headers.get('content-disposition')).toContain(
      `dealer-return-handoff-${id}.${format}`,
    )
    // Response.text strips a UTF-8 BOM; byte comparison also checks the CSV BOM.
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(
      new TextEncoder().encode(
        format === 'csv'
          ? returnHandoffCsv(returnHandoffFixture)
          : returnHandoffJson(returnHandoffFixture),
      ),
    )
  },
)
it('rejects signed-out requests before querying data', async () => {
  mocks.session.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) })
  expect((await request()).status).toBe(401)
  expect(mocks.context).not.toHaveBeenCalled()
  expect(mocks.from).not.toHaveBeenCalled()
})
it('hides unavailable tenant/branch records and requires an active organization', async () => {
  mocks.single.mockResolvedValue({ data: null, error: null })
  expect((await request()).status).toBe(404)
  mocks.context.mockResolvedValue(null)
  expect((await request()).status).toBe(404)
})
it('rejects malformed identities/formats before querying and returns safe failures', async () => {
  expect((await request('xml')).status).toBe(400)
  expect((await request('json', 'bad')).status).toBe(400)
  expect(mocks.from).not.toHaveBeenCalled()
  mocks.single.mockResolvedValue({ data: { payload: {} }, error: null })
  expect((await request()).status).toBe(500)
  mocks.single.mockResolvedValue({ error: { code: 'MQ403', message: 'secret detail' } })
  const result = await request()
  expect(result.status).toBe(403)
  expect(await result.text()).not.toContain('secret detail')
})
