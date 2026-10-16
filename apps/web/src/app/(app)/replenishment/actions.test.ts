import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ editor: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/forms', () => import('../../../lib/forms'))
vi.mock('@/lib/replenishment', () => import('../../../lib/replenishment'))
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
import { saveDraft } from './actions'
import { idleState } from '../../../lib/forms'
const id = '98000000-0000-4000-8000-000000000001'
function form() {
  const f = new FormData()
  Object.entries({
    organization_id: 'untrusted',
    policy: id,
    basis: 'calculated',
    override: '',
    backorders: '999999999999999.999',
    confirmed: 'true',
    request_id: id,
    fingerprint: 'a'.repeat(64),
  }).forEach(([k, v]) => f.set(k, v))
  return f
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.editor.mockResolvedValue({ ok: true, organizationId: 'session-org' })
  mocks.rpc.mockResolvedValue({ data: id, error: null })
})
it('saves exact input under the guarded organization and redirects to its evidence', async () => {
  await expect(saveDraft(idleState, form())).rejects.toThrow(`REDIRECT /replenishment/${id}`)
  expect(mocks.rpc).toHaveBeenCalledWith(
    'replenishment_save',
    expect.objectContaining({
      p_organization_id: 'session-org',
      p_backorders: '999999999999999.999',
      p_orders_confirmed: true,
    }),
  )
})
it('rejects malformed data and stale organization forms before RPC', async () => {
  const f = form()
  f.set('backorders', '-1')
  expect((await saveDraft(idleState, f)).code).toBe('validation')
  mocks.editor.mockResolvedValue({
    ok: false,
    state: { status: 'error', code: 'stale_organization' },
  })
  expect((await saveDraft(idleState, form())).code).toBe('stale_organization')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('asks for a refreshed preview on conflict without exposing database details', async () => {
  mocks.rpc.mockResolvedValue({ error: { code: 'MQ409', message: 'private details' } })
  const state = await saveDraft(idleState, form())
  expect(state.message).toBe('changed')
  expect(JSON.stringify(state)).not.toContain('private')
  expect(mocks.revalidate).not.toHaveBeenCalled()
})
