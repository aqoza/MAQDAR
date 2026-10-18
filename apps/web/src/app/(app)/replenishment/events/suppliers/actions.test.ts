import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ editor: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/forms', () => import('../../../../../lib/forms'))
vi.mock('@/lib/event-suppliers', () => import('../../../../../lib/event-suppliers'))
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
import { saveEventSupplier, previewEventSupplier } from './actions'
import { idleState } from '../../../../../lib/forms'
const id = '99100000-0000-4000-8000-000000000001'
function form() {
  const form = new FormData()
  Object.entries({
    organization_id: 'untrusted',
    draft_id: id,
    supplier_code: 'SUP',
    terms_confirmed: 'true',
    request_id: id,
    fingerprint: 'a'.repeat(64),
    target: '999',
  }).forEach(([k, v]) => form.set(k, v))
  return form
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.editor.mockResolvedValue({ ok: true, organizationId: 'session-org' })
  mocks.rpc.mockResolvedValue({ data: id, error: null })
})
it('uses the guarded organization and only saved evidence identifiers', async () => {
  await expect(saveEventSupplier(idleState, form())).rejects.toThrow(
    `REDIRECT /replenishment/events/suppliers/${id}`,
  )
  expect(mocks.rpc).toHaveBeenCalledWith('event_supplier_save', {
    p_organization_id: 'session-org',
    p_draft_id: id,
    p_supplier_code: 'SUP',
    p_terms_confirmed: true,
    p_request_id: id,
    p_fingerprint: 'a'.repeat(64),
  })
})
it('rejects invalid inputs and stale organizations before calling the RPC', async () => {
  const f = form()
  f.set('supplier_code', 'bad code')
  expect((await previewEventSupplier(idleState, f)).code).toBe('validation')
  expect((await saveEventSupplier(idleState, f)).code).toBe('validation')
  mocks.editor.mockResolvedValue({
    ok: false,
    state: { status: 'error', code: 'stale_organization' },
  })
  expect((await previewEventSupplier(idleState, form())).code).toBe('stale_organization')
  expect((await saveEventSupplier(idleState, form())).code).toBe('stale_organization')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it.each([
  'supplier_inactive',
  'unit_unknown',
  'unit_mismatch',
  'terms_unconfirmed',
  'lead_time_mismatch',
  'draft_unavailable',
  'quantity_out_of_range',
])('explains unavailable %s without offering a report', async (status) => {
  mocks.rpc.mockResolvedValue({ data: { status }, error: null })
  expect(await previewEventSupplier(idleState, form())).toEqual({
    status: 'error',
    message: `statuses.${status}`,
  })
})
it('sanitizes database errors and requires refreshing changed evidence', async () => {
  mocks.rpc.mockResolvedValue({ error: { code: 'MQ409', message: 'private' } })
  expect(await saveEventSupplier(idleState, form())).toEqual({
    status: 'error',
    message: 'changed',
  })
  mocks.rpc.mockResolvedValue({ error: { code: 'MQ404', message: 'private' } })
  expect(await previewEventSupplier(idleState, form())).toEqual({ status: 'error', code: 'MQ404' })
})
