import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ editor: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/forms', () => import('../../../../lib/forms'))
vi.mock('@/lib/redistribution', () => import('../../../../lib/redistribution'))
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
import { saveRedistribution } from './actions'
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
    lane: 'true',
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
it('saves the explicit inputs only under the guarded organization', async () => {
  await expect(saveRedistribution(idleState, form())).rejects.toThrow(
    `REDIRECT /replenishment/redistribution/${id}`,
  )
  expect(mocks.rpc).toHaveBeenCalledWith('redistribution_save', {
    p_organization_id: 'session-org',
    p_draft_id: id,
    p_source_policy_id: id,
    p_basis: 'calculated',
    p_override_id: undefined,
    p_backorders: '4.125',
    p_commitments_confirmed: true,
    p_lane_confirmed: true,
    p_request_id: id,
    p_fingerprint: 'a'.repeat(64),
  })
})
it('rejects malformed quantities and unconfirmed inputs before RPC', async () => {
  for (const [key, value] of [
    ['backorders', '-1'],
    ['lane', 'false'],
    ['commitments', 'false'],
    ['maximum', 'approved'],
  ]) {
    const valueForm = form()
    valueForm.set(key, value)
    expect((await saveRedistribution(idleState, valueForm)).code).toBe('validation')
  }
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('rejects a stale organization or role guard without RPC', async () => {
  mocks.editor.mockResolvedValue({
    ok: false,
    state: { status: 'error', code: 'stale_organization' },
  })
  expect((await saveRedistribution(idleState, form())).code).toBe('stale_organization')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('prompts refresh without exposing internal diagnostics', async () => {
  mocks.rpc.mockResolvedValue({ error: { code: 'MQ409', message: 'private evidence' } })
  expect((await saveRedistribution(idleState, form())).message).toBe('changed')
  expect(mocks.revalidate).not.toHaveBeenCalled()
})
