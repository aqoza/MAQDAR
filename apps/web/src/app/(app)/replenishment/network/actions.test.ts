import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ editor: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/forms', () => import('../../../../lib/forms'))
vi.mock('@/lib/network-allocation', () => import('../../../../lib/network-allocation'))
vi.mock('@/lib/organizations/guard', () => ({
  requireEditor: mocks.editor,
  invalidState: async () => ({ status: 'error', code: 'validation' }),
  rpcErrorState: async (e: { code: string }) => ({ status: 'error', code: e.code }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`)
  },
}))
import { saveNetworkAllocation } from './actions'
import { idleState } from '../../../../lib/forms'
const id = 'a8000000-0000-4000-8000-000000000001'
function form() {
  const form = new FormData()
  Object.entries({
    organization_id: 'untrusted',
    draft: id,
    policy: id,
    maximum: 'calculated',
    backorders: '4.125',
    commitments: 'true',
    lanes: 'true',
    request_id: id,
    fingerprint: 'a'.repeat(64),
  }).forEach(([key, value]) => form.set(key, value))
  return form
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.editor.mockResolvedValue({ ok: true, organizationId: 'session-org' })
  mocks.rpc.mockResolvedValue({ data: id, error: null })
})
it('uses the guarded organization and explicit selection', async () => {
  await expect(saveNetworkAllocation(idleState, form())).rejects.toThrow(
    `REDIRECT /replenishment/network/${id}`,
  )
  expect(mocks.rpc).toHaveBeenCalledWith(
    'network_allocation_save',
    expect.objectContaining({
      p_organization_id: 'session-org',
      p_draft_ids: [id],
      p_source_policy_id: id,
      p_backorders: '4.125',
    }),
  )
})
it('rejects invalid quantities, duplicate selections and unconfirmed saves before RPC', async () => {
  for (const [key, value] of [
    ['backorders', '-1'],
    ['lanes', 'false'],
    ['commitments', 'false'],
    ['maximum', 'approved'],
  ]) {
    const f = form()
    f.set(key, value)
    expect((await saveNetworkAllocation(idleState, f)).code).toBe('validation')
  }
  const duplicate = form()
  duplicate.append('draft', id)
  expect((await saveNetworkAllocation(idleState, duplicate)).code).toBe('validation')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('enforces stale-org/role guard and redacts database diagnostics', async () => {
  mocks.editor.mockResolvedValueOnce({
    ok: false,
    state: { status: 'error', code: 'stale_organization' },
  })
  expect((await saveNetworkAllocation(idleState, form())).code).toBe('stale_organization')
  expect(mocks.rpc).not.toHaveBeenCalled()
  mocks.rpc.mockResolvedValue({ error: { code: 'MQ409', message: 'private evidence' } })
  expect((await saveNetworkAllocation(idleState, form())).message).toBe('changed')
  expect(mocks.revalidate).not.toHaveBeenCalled()
})
