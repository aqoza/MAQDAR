import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  editor: vi.fn(),
  rpc: vi.fn(),
  revalidate: vi.fn(),
  context: vi.fn(),
  choices: vi.fn(),
}))
vi.mock('@/lib/forms', () => import('../../../../../lib/forms'))
vi.mock('@/lib/regional-sourcing', () => import('../../../../../lib/regional-sourcing'))
vi.mock('@/lib/regional-sourcing.server', () => ({
  sourcingContext: mocks.context,
  sourcingChoices: mocks.choices,
}))
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
import { previewRegionalSourcing, saveRegionalSourcing, loadSourcingOptions } from './actions'
import { idleState } from '../../../../../lib/forms'
const id = 'ac251000-0000-4000-8000-000000000001'
const input = {
  region_id: id,
  draft_id: id,
  sources: [{ location_id: id, policy_id: id, maximum: 'calculated', backorders: '0.000' }],
  commitments_confirmed: true,
  lanes_confirmed: true,
}
function form(payload: unknown = input) {
  const data = new FormData()
  Object.entries({
    organization_id: 'untrusted',
    input: JSON.stringify(payload),
    request_id: id,
    fingerprint: 'a'.repeat(64),
    region: id,
    draft: id,
    location: id,
    policy: '',
    page: '1',
    revisionPage: '1',
  }).forEach(([k, v]) => data.set(k, v))
  return data
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.editor.mockResolvedValue({ ok: true, organizationId: 'guarded-org' })
  mocks.rpc.mockResolvedValue({ data: id, error: null })
  mocks.context.mockResolvedValue({ valid: true })
  mocks.choices.mockResolvedValue({ policies: [] })
})
it('saves exact inputs only within the guarded organization', async () => {
  await expect(saveRegionalSourcing(idleState, form())).rejects.toThrow(
    `REDIRECT /replenishment/regional-stock/sourcing/${id}`,
  )
  expect(mocks.rpc).toHaveBeenCalledWith('regional_sourcing_save', {
    p_organization_id: 'guarded-org',
    p_input: input,
    p_request_id: id,
    p_fingerprint: 'a'.repeat(64),
  })
})
it('rejects malformed, oversized and unconfirmed inputs before RPC', async () => {
  for (const payload of [
    null,
    { ...input, sources: [] },
    { ...input, lanes_confirmed: false },
    { ...input, padding: 'x'.repeat(16385) },
  ])
    expect(await saveRegionalSourcing(idleState, form(payload))).toMatchObject({ status: 'error' })
  const data = form()
  data.set('input', '{bad')
  expect(await previewRegionalSourcing(idleState, data)).toMatchObject({ status: 'error' })
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('denies all actions after active-organization or editor authority changes', async () => {
  mocks.editor.mockResolvedValue({
    ok: false,
    state: { status: 'error', code: 'stale_organization' },
  })
  for (const action of [previewRegionalSourcing, saveRegionalSourcing, loadSourcingOptions])
    expect(await action(idleState, form())).toMatchObject({ code: 'stale_organization' })
  expect(mocks.rpc).not.toHaveBeenCalled()
  expect(mocks.context).not.toHaveBeenCalled()
})
it('maps conflicts and private RPC failures safely', async () => {
  for (const code of ['MQ409', 'MQ422', 'MQ403', 'MQ404']) {
    mocks.rpc.mockResolvedValue({ error: { code, message: 'private source' } })
    for (const action of [previewRegionalSourcing, saveRegionalSourcing]) {
      const result = await action(idleState, form())
      expect(result.status).toBe('error')
      expect(JSON.stringify(result)).not.toContain('private')
    }
  }
  expect(mocks.revalidate).not.toHaveBeenCalled()
})
it('validates pagination and rechecks full-region context for source choices', async () => {
  const data = form()
  data.set('page', '0')
  expect(await loadSourcingOptions(idleState, data)).toMatchObject({ status: 'error' })
  expect(mocks.context).not.toHaveBeenCalled()
  data.set('page', '2')
  expect(await loadSourcingOptions(idleState, data)).toMatchObject({ status: 'success' })
  expect(mocks.context).toHaveBeenCalledWith('guarded-org', id, id)
  expect(mocks.choices).toHaveBeenCalledWith('guarded-org', { valid: true }, id, 2, '', 1)
  mocks.context.mockResolvedValue(null)
  expect(await loadSourcingOptions(idleState, data)).toMatchObject({ code: 'MQ404' })
})
