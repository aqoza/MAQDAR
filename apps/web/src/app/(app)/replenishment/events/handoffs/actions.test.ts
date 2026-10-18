import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ editor: vi.fn(), rpc: vi.fn() }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))
vi.mock('@/lib/forms', () => import('../../../../../lib/forms'))
vi.mock('@/lib/event-purchase-handoffs', () => import('../../../../../lib/event-purchase-handoffs'))
vi.mock('@/lib/organizations/guard', () => ({
  requireEditor: mocks.editor,
  invalidState: async () => ({ status: 'error', code: 'validation' }),
  rpcErrorState: async (e: { code: string }) => ({ status: 'error', code: e.code }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('REDIRECT')
  },
}))
import { createHandoff } from './actions'
import { idleState } from '../../../../../lib/forms'
const id = '93000000-0000-4000-8000-000000000001'
function form() {
  const f = new FormData()
  f.set('organization_id', 'untrusted')
  f.set('proposal_id', id)
  return f
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.editor.mockResolvedValue({ ok: true, organizationId: 'session-org' })
  mocks.rpc.mockResolvedValue({ data: id, error: null })
})
it('creates from a validated proposal with session-derived organization and no editable values', async () => {
  await expect(createHandoff(idleState, form())).rejects.toThrow('REDIRECT')
  expect(mocks.rpc).toHaveBeenCalledWith('event_purchase_handoff_create', {
    p_organization_id: 'session-org',
    p_proposal_id: id,
  })
})
it('rejects malformed inputs and stale organization/editor guards before writing', async () => {
  const input = form()
  input.set('proposal_id', 'bad')
  expect((await createHandoff(idleState, input)).code).toBe('validation')
  mocks.editor.mockResolvedValue({ ok: false, state: { status: 'error', code: 'MQ403' } })
  expect((await createHandoff(idleState, form())).code).toBe('MQ403')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it.each([
  'handoff_selection_changed',
  'event_purchase_price_changed',
  'event_purchase_policy_required',
  'event_purchase_timing_required',
  'unknown',
])('maps %s without exposing database details', async (hint) => {
  mocks.rpc.mockResolvedValue({ error: { code: 'MQ409', hint, message: 'private detail' } })
  const result = await createHandoff(idleState, form())
  expect(result.status).toBe('error')
  expect(JSON.stringify(result)).not.toContain('private detail')
})
