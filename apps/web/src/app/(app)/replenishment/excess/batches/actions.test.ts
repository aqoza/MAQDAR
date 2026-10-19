import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ editor: vi.fn(), rpc: vi.fn() }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))
vi.mock('@/lib/forms', () => import('../../../../../lib/forms'))
vi.mock(
  '@/lib/excess-disposition-batches',
  () => import('../../../../../lib/excess-disposition-batches'),
)
vi.mock('@/lib/organizations/guard', () => ({
  requireEditor: mocks.editor,
  invalidState: async () => ({ status: 'error', code: 'validation' }),
  rpcErrorState: async (e: { code: string }) => ({ status: 'error', code: e.code }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('REDIRECT')
  },
}))
import { createBatch } from './actions'
import { idleState } from '../../../../../lib/forms'
const id = '93000000-0000-4000-8000-000000000001'
function form() {
  const f = new FormData()
  f.set('organization_id', 'untrusted')
  f.append('handoff', id)
  return f
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.editor.mockResolvedValue({ ok: true, organizationId: 'session-org' })
  mocks.rpc.mockResolvedValue({ data: id, error: null })
})
it('creates from a validated handoff set with session-derived organization and no editable values', async () => {
  await expect(createBatch(idleState, form())).rejects.toThrow('REDIRECT')
  expect(mocks.rpc).toHaveBeenCalledWith('excess_disposition_handoff_batch_create', {
    p_organization_id: 'session-org',
    p_handoff_ids: [id],
  })
})
it('rejects malformed inputs and stale organization/editor guards before writing', async () => {
  const input = form()
  input.set('handoff', 'bad')
  expect((await createBatch(idleState, input)).code).toBe('validation')
  mocks.editor.mockResolvedValue({ ok: false, state: { status: 'error', code: 'MQ403' } })
  expect((await createBatch(idleState, form())).code).toBe('MQ403')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it.each([
  'handoff_selection_changed',
  'excess_disposition_changed',
  'batch_group_mismatch',
  'batch_duplicate_item',
  'batch_selection_invalid',
  'batch_source_invalid',
  'unknown',
])('maps %s without exposing database details', async (hint) => {
  mocks.rpc.mockResolvedValue({ error: { code: 'MQ409', hint, message: 'private detail' } })
  const result = await createBatch(idleState, form())
  expect(result.status).toBe('error')
  expect(JSON.stringify(result)).not.toContain('private detail')
})
