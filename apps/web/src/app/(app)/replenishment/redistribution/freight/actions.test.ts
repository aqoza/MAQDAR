import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ editor: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/forms', () => import('../../../../../lib/forms'))
vi.mock('@/lib/transfer-freight', () => import('../../../../../lib/transfer-freight'))
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
import { saveTransferFreight } from './actions'
import { idleState } from '../../../../../lib/forms'
const id = 'a8100000-0000-4000-8000-000000000001'
function form() {
  const form = new FormData()
  Object.entries({
    organization_id: 'untrusted',
    scenario: id,
    confirmed: 'true',
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
it('saves under the guarded organization and redirects only after success', async () => {
  await expect(saveTransferFreight(idleState, form())).rejects.toThrow(
    `REDIRECT /replenishment/redistribution/freight/${id}`,
  )
  expect(mocks.rpc).toHaveBeenCalledWith('transfer_freight_save', {
    p_organization_id: 'session-org',
    p_scenario_id: id,
    p_terms_confirmed: true,
    p_request_id: id,
    p_fingerprint: 'a'.repeat(64),
  })
  expect(mocks.revalidate).toHaveBeenCalledWith('/replenishment/redistribution/freight')
})
it('rejects invalid inputs before calling the database', async () => {
  for (const [key, value] of [
    ['confirmed', 'yes'],
    ['scenario', 'bad'],
    ['fingerprint', 'bad'],
  ]) {
    const invalid = form()
    invalid.set(key, value)
    expect((await saveTransferFreight(idleState, invalid)).code).toBe('validation')
  }
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('stops at a failed role or organization guard', async () => {
  mocks.editor.mockResolvedValue({
    ok: false,
    state: { status: 'error', code: 'stale_organization' },
  })
  expect((await saveTransferFreight(idleState, form())).code).toBe('stale_organization')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('prompts refresh for stale evidence without exposing database diagnostics', async () => {
  mocks.rpc.mockResolvedValue({ error: { code: 'MQ409', message: 'private evidence' } })
  expect((await saveTransferFreight(idleState, form())).message).toBe('changed')
  expect(mocks.revalidate).not.toHaveBeenCalled()
})
it('maps access errors without revalidating or redirecting', async () => {
  mocks.rpc.mockResolvedValue({ error: { code: 'MQ404', message: 'private evidence' } })
  expect((await saveTransferFreight(idleState, form())).code).toBe('MQ404')
  expect(mocks.revalidate).not.toHaveBeenCalled()
})
