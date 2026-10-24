import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ editor: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/organizations/guard', () => ({
  requireEditor: mocks.editor,
  invalidState: async () => ({ status: 'error', code: 'validation' }),
  rpcErrorState: async (e: { code: string }) => ({ status: 'error', code: e.code }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error('REDIRECT ' + path)
  },
}))
vi.mock('@/lib/dealer-return-handoffs', () => import('../../../../../lib/dealer-return-handoffs'))
vi.mock('@/lib/dealer-returns', () => import('../../../../../lib/dealer-returns'))
import { createReturnHandoff } from './actions'
import { idleState } from '../../../../../lib/forms'
const id = 'cc270000-0000-4000-8000-000000000001'
const form = () => {
  const f = new FormData()
  f.set('organization_id', 'untrusted')
  f.set('return_id', id)
  return f
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.editor.mockResolvedValue({ ok: true, organizationId: 'guarded' })
  mocks.rpc.mockResolvedValue({ data: id, error: null })
})
it('exports only through guarded organization and source identity; refreshes both views', async () => {
  await expect(createReturnHandoff(idleState, form())).rejects.toThrow(
    'REDIRECT /replenishment/returns/handoffs/' + id,
  )
  expect(mocks.rpc).toHaveBeenCalledWith('dealer_return_handoff_create', {
    p_organization_id: 'guarded',
    p_return_id: id,
  })
  expect(mocks.revalidate).toHaveBeenCalledWith('/replenishment/returns/' + id)
  expect(mocks.revalidate).toHaveBeenCalledWith('/replenishment/returns/handoffs')
})
it('refuses unavailable authority and malformed identity before querying', async () => {
  const invalid = form()
  invalid.set('return_id', 'bad')
  expect(await createReturnHandoff(idleState, invalid)).toMatchObject({ code: 'validation' })
  mocks.editor.mockResolvedValue({ ok: false, state: { status: 'error', code: 'forbidden' } })
  expect(await createReturnHandoff(idleState, form())).toMatchObject({ code: 'forbidden' })
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('returns safe catalog conflicts without redirect or stale success', async () => {
  mocks.rpc.mockResolvedValue({ error: { code: 'MQ409', message: 'private catalog details' } })
  expect(await createReturnHandoff(idleState, form())).toEqual({
    status: 'error',
    code: 'MQ409',
    message: 'unavailable',
  })
  expect(mocks.revalidate).not.toHaveBeenCalled()
})
