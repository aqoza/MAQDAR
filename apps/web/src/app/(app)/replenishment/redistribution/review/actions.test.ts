vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  editor: vi.fn(),
  active: vi.fn(),
  rpc: vi.fn(),
  revalidate: vi.fn(),
}))
vi.mock('@/lib/forms', () => import('../../../../../lib/forms'))
vi.mock('@/lib/transfer-review', () => import('../../../../../lib/transfer-review'))
vi.mock('@/lib/organizations/guard', () => ({
  requireEditor: mocks.editor,
  requireActiveOrganization: mocks.active,
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
import { submitProposal, decideProposal } from './actions'
import { idleState } from '../../../../../lib/forms'
const id = '93000000-0000-4000-8000-000000000001'
function form() {
  const f = new FormData()
  Object.entries({
    organization_id: 'untrusted',
    estimate_id: id,
    proposal_id: id,
    request_id: id,
    reason: ' Reviewed ',
    decision: 'approved',
  }).forEach(([k, v]) => f.set(k, v))
  return f
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.editor.mockResolvedValue({ ok: true, organizationId: 'session-org' })
  mocks.active.mockResolvedValue({ ok: true, organizationId: 'session-org' })
  mocks.rpc.mockResolvedValue({ data: id, error: null })
})
it('submits immutable source identity using the active organization', async () => {
  await expect(submitProposal(idleState, form())).rejects.toThrow('REDIRECT')
  expect(mocks.rpc).toHaveBeenCalledWith(
    'transfer_proposal_submit',
    expect.objectContaining({
      p_organization_id: 'session-org',
      p_estimate_id: id,
      p_reason: 'Reviewed',
    }),
  )
})
it('does not call the database for malformed source identities or stale forms', async () => {
  const f = form()
  f.set('estimate_id', 'invalid')
  expect((await submitProposal(idleState, f)).code).toBe('validation')
  mocks.editor.mockResolvedValue({
    ok: false,
    state: { status: 'error', code: 'stale_organization' },
  })
  expect((await submitProposal(idleState, form())).code).toBe('stale_organization')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('routes approval and author withdrawal through the guarded decision RPC', async () => {
  const f = form()
  f.set('decision', 'withdrawn')
  await expect(decideProposal(idleState, f)).rejects.toThrow('REDIRECT')
  expect(mocks.rpc).toHaveBeenCalledWith(
    'transfer_proposal_decide',
    expect.objectContaining({ p_organization_id: 'session-org', p_decision: 'withdrawn' }),
  )
  expect(mocks.active).toHaveBeenCalled()
})
it('rejects stale or malformed decisions without calling the database', async () => {
  const f = form()
  f.set('decision', 'pending')
  expect((await decideProposal(idleState, f)).code).toBe('validation')
  mocks.active.mockResolvedValue({
    ok: false,
    state: { status: 'error', code: 'stale_organization' },
  })
  expect((await decideProposal(idleState, form())).code).toBe('stale_organization')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('preserves input and hides internal rejection details', async () => {
  mocks.rpc.mockResolvedValue({ error: { code: 'MQ403', message: 'private database detail' } })
  const result = await decideProposal(idleState, form())
  expect(result).toMatchObject({ code: 'MQ403', values: { reason: 'Reviewed' } })
  expect(JSON.stringify(result)).not.toContain('private')
})

it.each(['transfer_freight_changed', 'transfer_pending', 'transfer_timing_required'])(
  'shows safe review errors for %s',
  async (hint) => {
    mocks.rpc.mockResolvedValue({ error: { code: 'MQ409', hint, message: 'private' } })
    const result = await decideProposal(idleState, form())
    expect(result.status).toBe('error')
    expect(result.message).toBeTruthy()
    expect(JSON.stringify(result)).not.toContain('private')
  },
)
