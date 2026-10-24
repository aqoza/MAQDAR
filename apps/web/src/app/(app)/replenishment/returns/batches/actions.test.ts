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
vi.mock('@/lib/dealer-return-batches', () => import('../../../../../lib/dealer-return-batches'))
import { createReturnBatch } from './actions'
import { idleState } from '../../../../../lib/forms'
const id = 'cd270000-0000-4000-8000-000000000001'
const form = () => {
  const f = new FormData()
  f.set('organization_id', 'untrusted')
  f.append('handoff', id)
  return f
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.editor.mockResolvedValue({ ok: true, organizationId: 'guarded' })
  mocks.rpc.mockResolvedValue({ data: id, error: null })
})
it('saves only the selected IDs in the guarded organization', async () => {
  await expect(createReturnBatch(idleState, form())).rejects.toThrow(
    'REDIRECT /replenishment/returns/batches/' + id,
  )
  expect(mocks.rpc).toHaveBeenCalledWith('dealer_return_batch_create', {
    p_organization_id: 'guarded',
    p_handoff_ids: [id],
  })
  expect(mocks.revalidate).toHaveBeenCalledWith('/replenishment/returns/batches')
})
it('rejects invalid or duplicated IDs and unavailable authority before database access', async () => {
  for (const ids of [[], ['bad'], [id, id]]) {
    const f = form()
    f.delete('handoff')
    for (const v of ids) f.append('handoff', v)
    expect(await createReturnBatch(idleState, f)).toMatchObject({ code: 'validation' })
  }
  mocks.editor.mockResolvedValue({ ok: false, state: { status: 'error', code: 'forbidden' } })
  expect(await createReturnBatch(idleState, form())).toMatchObject({ code: 'forbidden' })
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it.each([
  ['MQ422', 'batch_duplicate_item', 'duplicateItem'],
  ['MQ422', 'batch_group_mismatch', 'groupMismatch'],
  ['MQ409', 'return_evidence_changed', 'evidenceChanged'],
  ['MQ404', 'private detail', 'unavailable'],
])('maps %s/%s to safe feedback', async (code, hint, message) => {
  mocks.rpc.mockResolvedValue({ error: { code, hint, message: 'private database details' } })
  expect(await createReturnBatch(idleState, form())).toEqual({ status: 'error', code, message })
  expect(mocks.revalidate).not.toHaveBeenCalled()
})
