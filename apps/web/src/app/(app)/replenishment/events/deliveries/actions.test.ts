import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ editor: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/delivery-scenarios', () => import('../../../../../lib/delivery-scenarios'))
vi.mock('@/lib/forms', () => import('../../../../../lib/forms'))
vi.mock('@/lib/event-deliveries', () => import('../../../../../lib/event-deliveries'))
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
import { saveEventDelivery, previewEventDelivery } from './actions'
import { idleState } from '../../../../../lib/forms'
const id = '99100000-0000-4000-8000-000000000001'
function form() {
  const form = new FormData()
  Object.entries({
    organization_id: 'untrusted',
    scenario_id: id,
    requested_date: '2026-10-10',
    calendars_confirmed: 'true',
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
  await expect(saveEventDelivery(idleState, form())).rejects.toThrow(
    `REDIRECT /replenishment/events/deliveries/${id}`,
  )
  expect(mocks.rpc).toHaveBeenCalledWith('event_delivery_save', {
    p_organization_id: 'session-org',
    p_scenario_id: id,
    p_requested_date: '2026-10-10',
    p_calendars_confirmed: true,
    p_request_id: id,
    p_fingerprint: 'a'.repeat(64),
  })
})
it('rejects invalid inputs and stale organizations before calling the RPC', async () => {
  const f = form()
  f.set('requested_date', 'bad date')
  expect((await previewEventDelivery(idleState, f)).code).toBe('validation')
  expect((await saveEventDelivery(idleState, f)).code).toBe('validation')
  mocks.editor.mockResolvedValue({
    ok: false,
    state: { status: 'error', code: 'stale_organization' },
  })
  expect((await previewEventDelivery(idleState, form())).code).toBe('stale_organization')
  expect((await saveEventDelivery(idleState, form())).code).toBe('stale_organization')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it.each(['source_unavailable'])(
  'explains unavailable %s without offering a report',
  async (status) => {
    mocks.rpc.mockResolvedValue({ data: { status }, error: null })
    expect(await previewEventDelivery(idleState, form())).toEqual({
      status: 'error',
      message: `statuses.${status}`,
    })
  },
)
it('sanitizes database errors and requires refreshing changed evidence', async () => {
  mocks.rpc.mockResolvedValue({ error: { code: 'MQ409', message: 'private' } })
  expect(await saveEventDelivery(idleState, form())).toEqual({
    status: 'error',
    message: 'changed',
  })
  mocks.rpc.mockResolvedValue({ error: { code: 'MQ404', message: 'private' } })
  expect(await previewEventDelivery(idleState, form())).toEqual({ status: 'error', code: 'MQ404' })
})
