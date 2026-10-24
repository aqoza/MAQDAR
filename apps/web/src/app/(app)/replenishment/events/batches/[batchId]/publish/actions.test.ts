import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ editor: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/organizations/guard', () => ({
  requireEditor: mocks.editor,
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
import { publishEventBatchSupplier, withdrawEventBatchSupplier } from './actions'
const idle = { status: 'idle' as const }
const id = '93000000-0000-4000-8000-000000000001'
function form() {
  const f = new FormData()
  f.set('organization_id', 'untrusted')
  f.set('batch_id', id)
  f.set('publication_id', id)
  f.set('confirmed', 'on')
  f.set('fingerprint', 'reviewed-preview')
  f.set('quantity', '999')
  f.set('subtotal', '0')
  return f
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.editor.mockResolvedValue({ ok: true, organizationId: 'session-org' })
  mocks.rpc.mockResolvedValue({ data: id, error: null })
})
it('publishes only a confirmed preview identity under the current organization', async () => {
  await expect(publishEventBatchSupplier(idle, form())).rejects.toThrow('REDIRECT')
  expect(mocks.rpc).toHaveBeenCalledWith('supplier_event_batch_publication_publish', {
    p_organization_id: 'session-org',
    p_batch_id: id,
    p_confirmed: true,
    p_fingerprint: 'reviewed-preview',
  })
})
it('passes missing confirmation as false and never trusts submitted summary fields', async () => {
  const f = form()
  f.delete('confirmed')
  f.delete('fingerprint')
  mocks.rpc.mockResolvedValue({ error: { code: 'MQ422' } })
  expect((await publishEventBatchSupplier(idle, f)).code).toBe('MQ422')
  expect(mocks.rpc).toHaveBeenCalledWith('supplier_event_batch_publication_publish', {
    p_organization_id: 'session-org',
    p_batch_id: id,
    p_confirmed: false,
    p_fingerprint: '',
  })
})
it('withdraws using the current organization and invalidates supplier access', async () => {
  expect(await withdrawEventBatchSupplier(idle, form())).toEqual({ status: 'success' })
  expect(mocks.rpc).toHaveBeenCalledWith('supplier_event_batch_publication_withdraw', {
    p_organization_id: 'session-org',
    p_publication_id: id,
  })
  expect(mocks.revalidate).toHaveBeenCalledWith('/supplier-portal', 'layout')
})
it.each([publishEventBatchSupplier, withdrawEventBatchSupplier])(
  'rejects stale authority and malformed identities before RPC',
  async (action) => {
    const f = form()
    f.set('batch_id', 'bad')
    expect((await action(idle, f)).code).toBe('validation')
    mocks.editor.mockResolvedValue({ ok: false, state: { status: 'error', code: 'MQ403' } })
    expect((await action(idle, form())).code).toBe('MQ403')
    expect(mocks.rpc).not.toHaveBeenCalled()
  },
)
it('rejects invalid withdrawal publication identity', async () => {
  const f = form()
  f.set('publication_id', 'bad')
  expect((await withdrawEventBatchSupplier(idle, f)).code).toBe('validation')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it.each([publishEventBatchSupplier, withdrawEventBatchSupplier])(
  'maps database errors without returning private details',
  async (action) => {
    mocks.rpc.mockResolvedValue({ error: { code: 'MQ409', message: 'private event evidence' } })
    const result = await action(idle, form())
    expect(result.code).toBe('MQ409')
    expect(JSON.stringify(result)).not.toContain('private event evidence')
    expect(mocks.revalidate).not.toHaveBeenCalled()
  },
)
