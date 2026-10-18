import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ editor: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/forms', () => import('../../../../lib/forms'))
vi.mock('@/lib/planned-events', () => import('../../../../lib/planned-events'))
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
import { saveEvent, previewEvent } from './actions'
import { idleState } from '../../../../lib/forms'
const id = '99000000-0000-4000-8000-000000000001'
function form() {
  const f = new FormData()
  Object.entries({
    organization_id: 'untrusted',
    forecast_id: id,
    event_type: 'tender',
    name: 'Tender',
    reason: 'Additional demand',
    unit: 'EA',
    additions: '[{"date":"2026-10-11","quantity":"999999999999999.999"}]',
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
it('uses the guarded organization and exact quantities', async () => {
  await expect(saveEvent(idleState, form())).rejects.toThrow(`REDIRECT /forecasts/events/${id}`)
  expect(mocks.rpc).toHaveBeenCalledWith(
    'planned_event_save',
    expect.objectContaining({
      p_organization_id: 'session-org',
      p_additions: [{ date: '2026-10-11', quantity: '999999999999999.999' }],
      p_confirmed: true,
    }),
  )
})
it('rejects unconfirmed saves, malformed additions and stale organizations before RPC', async () => {
  const f = form()
  f.set('confirmed', 'false')
  expect((await saveEvent(idleState, f)).code).toBe('validation')
  f.set('additions', 'bad JSON')
  expect((await previewEvent(idleState, f)).code).toBe('validation')
  mocks.editor.mockResolvedValue({
    ok: false,
    state: { status: 'error', code: 'stale_organization' },
  })
  expect((await saveEvent(idleState, form())).code).toBe('stale_organization')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('sanitizes database errors and asks for a fresh preview', async () => {
  mocks.rpc.mockResolvedValue({ error: { code: 'MQ409', message: 'private evidence' } })
  expect(await saveEvent(idleState, form())).toEqual({ status: 'error', message: 'changed' })
  mocks.rpc.mockResolvedValue({ error: { code: 'MQ422', message: 'private evidence' } })
  expect(await previewEvent(idleState, form())).toEqual({ status: 'error', code: 'MQ422' })
})
