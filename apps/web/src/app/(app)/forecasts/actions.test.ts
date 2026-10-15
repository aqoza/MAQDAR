import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ guard: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/forms', () => import('../../../lib/forms'))
vi.mock('@/lib/planning', () => import('../../../lib/planning'))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('REDIRECT')
  },
}))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))
vi.mock('@/lib/organizations/guard', () => ({
  requireEditor: mocks.guard,
  invalidState: async () => ({ status: 'error', code: 'validation' }),
  rpcErrorState: async (error: { code: string }) => ({ status: 'error', code: error.code }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }))

import { cancelRun, enqueueRun } from './actions'
import { idleState } from '../../../lib/forms'

function form() {
  const data = new FormData()
  Object.entries({
    organization_id: 'untrusted',
    location_code: 'L1',
    from_date: '2026-10-01',
    to_date: '2026-10-02',
    request_id: '70000000-0000-4000-8000-000000000001',
  }).forEach(([key, value]) => data.set(key, value))
  return data
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.guard.mockResolvedValue({ ok: true, organizationId: 'session-org' })
  mocks.rpc.mockResolvedValue({ error: null })
})
it('stops stale organization or unauthorized requests at the shared editor guard', async () => {
  mocks.guard.mockResolvedValue({
    ok: false,
    state: { status: 'error', code: 'stale_organization' },
  })
  expect((await enqueueRun(idleState, form())).code).toBe('stale_organization')
  expect((await cancelRun(idleState, form())).code).toBe('stale_organization')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('uses the session organization instead of trusting the posted field', async () => {
  await expect(enqueueRun(idleState, form())).rejects.toThrow('REDIRECT')
  expect(mocks.rpc).toHaveBeenCalledWith(
    'planning_enqueue',
    expect.objectContaining({ p_organization_id: 'session-org', p_location_code: 'L1' }),
  )
})
it('rejects malformed dates before calling the RPC', async () => {
  const data = form()
  data.set('from_date', '2026-02-30')
  expect((await enqueueRun(idleState, data)).code).toBe('validation')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('returns a translated conflict without disclosing database messages', async () => {
  mocks.rpc.mockResolvedValue({ error: { code: 'MQ409', message: 'sensitive database detail' } })
  const result = await enqueueRun(idleState, form())
  expect(result.message).toBe('busy')
  expect(JSON.stringify(result)).not.toContain('sensitive')
})
it('rejects an invalid cancellation id', async () => {
  expect((await cancelRun(idleState, form())).code).toBe('validation')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
