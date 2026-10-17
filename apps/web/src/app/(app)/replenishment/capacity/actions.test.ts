import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ editor: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/forms', () => import('../../../../lib/forms'))
vi.mock('@/lib/container-capacity', () => import('../../../../lib/container-capacity'))
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
import { saveCapacity } from './actions'
import { idleState } from '../../../../lib/forms'
const id = '99000000-0000-4000-8000-000000000001'
function form() {
  const f = new FormData()
  Object.entries({
    organization_id: 'untrusted',
    batch: id,
    confirmed: 'true',
    volume: '10',
    payload: '100',
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
it('saves only the explicit selection under the guarded organization', async () => {
  await expect(saveCapacity(idleState, form())).rejects.toThrow(
    `REDIRECT /replenishment/capacity/${id}`,
  )
  expect(mocks.rpc).toHaveBeenCalledWith('container_capacity_save', {
    p_organization_id: 'session-org',
    p_batch_id: id,
    p_confirmed: true,
    p_volume: '10',
    p_payload: '100',
    p_request_id: id,
    p_fingerprint: 'a'.repeat(64),
  })
  expect(mocks.revalidate).toHaveBeenCalledWith(`/replenishment/batches/${id}`)
})
it('rejects malformed selections and stale organization forms before RPC', async () => {
  const f = form()
  f.set('confirmed', 'yes')
  expect((await saveCapacity(idleState, f)).code).toBe('validation')
  mocks.editor.mockResolvedValue({
    ok: false,
    state: { status: 'error', code: 'stale_organization' },
  })
  expect((await saveCapacity(idleState, form())).code).toBe('stale_organization')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('returns a refresh prompt without leaking database diagnostics', async () => {
  mocks.rpc.mockResolvedValue({ error: { code: 'MQ409', message: 'private terms' } })
  const state = await saveCapacity(idleState, form())
  expect(state.message).toBe('changed')
  expect(JSON.stringify(state)).not.toContain('private')
  expect(mocks.revalidate).not.toHaveBeenCalled()
})
