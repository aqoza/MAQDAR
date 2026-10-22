import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ editor: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))
vi.mock('@/lib/organizations/guard', () => ({
  requireEditor: mocks.editor,
  invalidState: async () => ({ status: 'error', code: 'validation' }),
  rpcErrorState: async (e: { code: string }) => ({ status: 'error', code: e.code }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('REDIRECT')
  },
}))
import { createHandoff } from './actions'
import { idleState } from '@/lib/forms'
const id = '93000000-0000-4000-8000-000000000001'
const form = () => {
  const f = new FormData()
  f.set('organization_id', 'untrusted')
  f.set('proposal_id', id)
  f.set('payload', 'untrusted')
  return f
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.editor.mockResolvedValue({ ok: true, organizationId: 'session-org' })
  mocks.rpc.mockResolvedValue({ data: id, error: null })
})
it('derives authority from the session and sends only the selected identity', async () => {
  await expect(createHandoff(idleState, form())).rejects.toThrow('REDIRECT')
  expect(mocks.rpc).toHaveBeenCalledWith('regional_handoff_create', {
    p_organization_id: 'session-org',
    p_proposal_id: id,
  })
  expect(mocks.revalidate).toHaveBeenCalledWith('/replenishment/regional-stock/sourcing/handoffs')
})
it('rejects invalid identities and stale organization forms before querying', async () => {
  const f = form()
  f.set('proposal_id', 'bad')
  expect((await createHandoff(idleState, f)).code).toBe('validation')
  mocks.editor.mockResolvedValue({
    ok: false,
    state: { status: 'error', code: 'stale_organization' },
  })
  expect((await createHandoff(idleState, form())).code).toBe('stale_organization')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it.each([
  ['regional_selection_changed', 'selectionChanged'],
  ['regional_freight_changed', 'freightChanged'],
  ['regional_timing_required', 'timingRequired'],
])('shows safe actionable %s errors', async (hint, message) => {
  mocks.rpc.mockResolvedValue({ error: { code: 'MQ409', hint, message: 'private details' } })
  expect((await createHandoff(idleState, form())).message).toBe(message)
})
it('retains standard role errors without leaking database details', async () => {
  mocks.rpc.mockResolvedValue({ error: { code: 'MQ403', message: 'private details' } })
  expect(await createHandoff(idleState, form())).toEqual({ status: 'error', code: 'MQ403' })
})
