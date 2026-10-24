import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  rpc: vi.fn(),
  revalidate: vi.fn(),
  redirect: vi.fn(),
}))
vi.mock('@/lib/supplier-portal-context', () => ({ requireSupplierPortal: mocks.guard }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }))
vi.mock('@/lib/organizations/guard', () => ({
  invalidState: async () => ({ status: 'error', code: 'validation' }),
  rpcErrorState: async (e: { code: string }) => ({ status: 'error', code: e.code }),
}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
import { respondEventSupplier } from './actions'
const id = 'a2670000-0000-4000-8000-000000000001'
const idle = { status: 'idle' as const }
function form() {
  const f = new FormData()
  for (const [key, value] of Object.entries({
    grant_id: id,
    publication_id: id,
    request_id: id,
    kind: 'batch',
    status: 'declined',
    reference: ' REF ',
    reason: ' Cannot supply ',
    organization_id: 'forged',
    actor_email: 'forged@example.com',
  }))
    f.set(key, value)
  return f
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.guard.mockResolvedValue({ id, accepted: true })
  mocks.rpc.mockResolvedValue({ data: id, error: null })
  mocks.redirect.mockImplementation(() => {
    throw new Error('REDIRECT')
  })
})
it.each(['handoff', 'batch'])(
  'uses event-only endpoint with grant-derived authority for %s',
  async (kind) => {
    const f = form()
    f.set('kind', kind)
    await expect(respondEventSupplier(idle, f)).rejects.toThrow('REDIRECT')
    expect(mocks.guard).toHaveBeenCalledWith(id)
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('supplier_event_response_submit', {
      p_grant_id: id,
      p_publication_id: id,
      p_request_id: id,
      p_kind: kind,
      p_status: 'declined',
      p_reference: 'REF',
      p_reason: 'Cannot supply',
    })
    expect(mocks.redirect).toHaveBeenCalledWith(`/supplier-portal/${id}/events/${id}`)
    expect(mocks.revalidate).toHaveBeenCalledWith('/replenishment', 'layout')
  },
)
it.each([
  ['status', 'accepted'],
  ['kind', 'ordinary'],
  ['reason', ' '],
  ['request_id', 'bad'],
  ['grant_id', 'bad'],
  ['reference', 'x'.repeat(121)],
])('rejects invalid %s before database access', async (key, value) => {
  const f = form()
  f.set(key, value)
  expect((await respondEventSupplier(idle, f)).code).toBe('validation')
  expect(mocks.rpc).not.toHaveBeenCalled()
  expect(mocks.guard).not.toHaveBeenCalled()
})
it('stops when current portal access is denied', async () => {
  mocks.guard.mockRejectedValue(new Error('NOT_FOUND'))
  await expect(respondEventSupplier(idle, form())).rejects.toThrow('NOT_FOUND')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it.each(['MQ404', 'MQ409'])(
  'returns safe database error %s and preserves entered text',
  async (code) => {
    mocks.rpc.mockResolvedValue({ error: { code, message: 'private event evidence' } })
    const result = await respondEventSupplier(idle, form())
    expect(result.code).toBe(code)
    expect(result.values?.reason).toBe('Cannot supply')
    expect(JSON.stringify(result)).not.toContain('private event evidence')
    expect(mocks.revalidate).not.toHaveBeenCalled()
  },
)
