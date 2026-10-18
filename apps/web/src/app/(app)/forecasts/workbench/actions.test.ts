import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  editor: vi.fn(),
  active: vi.fn(),
  rpc: vi.fn(),
  revalidate: vi.fn(),
}))
vi.mock('@/lib/validation', () => import('../../../../lib/validation'))
vi.mock('@/lib/forms', () => import('../../../../lib/forms'))
vi.mock('@/lib/policy-workbench', () => import('../../../../lib/policy-workbench'))
vi.mock('@/lib/organizations/guard', () => ({
  requireEditor: mocks.editor,
  requireActiveOrganization: mocks.active,
  invalidState: async () => ({ status: 'error', code: 'validation' }),
  rpcErrorState: async (e: { code: string }) => ({ status: 'error', code: e.code }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('REDIRECT')
  },
}))
import { submitOverride, decideOverride } from './actions'
import { idleState } from '../../../../lib/forms'
const id = '93000000-0000-4000-8000-000000000001'
function form() {
  const f = new FormData()
  Object.entries({
    organization_id: 'untrusted',
    policy_id: id,
    override_id: id,
    request_id: id,
    reorder_point: '999999999999999.998',
    order_up_to: '999999999999999.999',
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
it('submits exact strings using the active organization', async () => {
  await expect(submitOverride(idleState, form())).rejects.toThrow('REDIRECT')
  expect(mocks.rpc).toHaveBeenCalledWith(
    'policy_override_submit',
    expect.objectContaining({
      p_organization_id: 'session-org',
      p_reorder_point: '999999999999999.998',
      p_order_up_to: '999999999999999.999',
      p_reason: 'Reviewed',
    }),
  )
})
it('does not call the database for malformed quantities or stale forms', async () => {
  const f = form()
  f.set('reorder_point', 'NaN')
  expect((await submitOverride(idleState, f)).code).toBe('validation')
  mocks.editor.mockResolvedValue({
    ok: false,
    state: { status: 'error', code: 'stale_organization' },
  })
  expect((await submitOverride(idleState, form())).code).toBe('stale_organization')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('routes approval and author withdrawal through the guarded decision RPC', async () => {
  const f = form()
  f.set('decision', 'withdrawn')
  await expect(decideOverride(idleState, f)).rejects.toThrow('REDIRECT')
  expect(mocks.rpc).toHaveBeenCalledWith(
    'policy_override_decide',
    expect.objectContaining({ p_organization_id: 'session-org', p_decision: 'withdrawn' }),
  )
  expect(mocks.active).toHaveBeenCalled()
})
it('rejects stale or malformed decisions without calling the database', async () => {
  const f = form()
  f.set('decision', 'pending')
  expect((await decideOverride(idleState, f)).code).toBe('validation')
  mocks.active.mockResolvedValue({
    ok: false,
    state: { status: 'error', code: 'stale_organization' },
  })
  expect((await decideOverride(idleState, form())).code).toBe('stale_organization')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('preserves input and hides internal rejection details', async () => {
  mocks.rpc.mockResolvedValue({ error: { code: 'MQ403', message: 'private database detail' } })
  const result = await decideOverride(idleState, form())
  expect(result).toMatchObject({ code: 'MQ403', values: { reason: 'Reviewed' } })
  expect(JSON.stringify(result)).not.toContain('private')
})

it('identifies an inverted maximum and preserves entered values without writing', async () => {
  const f = form()
  f.set('reorder_point', '500')
  f.set('order_up_to', '400')
  expect(await submitOverride(idleState, f)).toMatchObject({
    code: 'validation',
    fieldErrors: { order_up_to: 'maximumBelowReorder' },
    values: { reorder_point: '500', order_up_to: '400', reason: 'Reviewed' },
  })
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('identifies malformed quantities and whitespace-only reasons before writing', async () => {
  const f = form()
  f.set('reorder_point', 'NaN')
  f.set('reason', '  ')
  expect(await submitOverride(idleState, f)).toMatchObject({
    fieldErrors: { reorder_point: 'policyQuantity', reason: 'required' },
  })
  expect(await decideOverride(idleState, f)).toMatchObject({
    fieldErrors: { reason: 'required' },
  })
  expect(mocks.rpc).not.toHaveBeenCalled()
})
