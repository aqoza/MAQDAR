import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ editor: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/forms', () => import('../../../../lib/forms'))
vi.mock('@/lib/supplier-scenarios', () => import('../../../../lib/supplier-scenarios'))
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
import { saveSupplierScenario } from './actions'
import { idleState } from '../../../../lib/forms'
const id = '99000000-0000-4000-8000-000000000001'
function form() {
  const f = new FormData()
  Object.entries({
    organization_id: 'untrusted',
    draft: id,
    supplier: 'SUP',
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
it('saves only the explicit selection under the guarded organization', async () => {
  await expect(saveSupplierScenario(idleState, form())).rejects.toThrow(
    `REDIRECT /replenishment/suppliers/${id}`,
  )
  expect(mocks.rpc).toHaveBeenCalledWith('supplier_scenario_save', {
    p_organization_id: 'session-org',
    p_draft_id: id,
    p_supplier_code: 'SUP',
    p_terms_confirmed: true,
    p_request_id: id,
    p_fingerprint: 'a'.repeat(64),
  })
  expect(mocks.revalidate).toHaveBeenCalledWith(`/replenishment/${id}`)
})
it('rejects malformed selections and stale organization forms before RPC', async () => {
  const f = form()
  f.set('supplier', 'BAD/ID')
  expect((await saveSupplierScenario(idleState, f)).code).toBe('validation')
  mocks.editor.mockResolvedValue({
    ok: false,
    state: { status: 'error', code: 'stale_organization' },
  })
  expect((await saveSupplierScenario(idleState, form())).code).toBe('stale_organization')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('returns a refresh prompt without leaking database diagnostics', async () => {
  mocks.rpc.mockResolvedValue({ error: { code: 'MQ409', message: 'private terms' } })
  const state = await saveSupplierScenario(idleState, form())
  expect(state.message).toBe('changed')
  expect(JSON.stringify(state)).not.toContain('private')
  expect(mocks.revalidate).not.toHaveBeenCalled()
})
