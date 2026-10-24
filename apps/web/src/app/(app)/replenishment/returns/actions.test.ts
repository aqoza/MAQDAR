import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  editor: vi.fn(),
  member: vi.fn(),
  rpc: vi.fn(),
  revalidate: vi.fn(),
}))
vi.mock('@/lib/forms', () => import('../../../../lib/forms'))
vi.mock('@/lib/dealer-returns', () => import('../../../../lib/dealer-returns'))
vi.mock('@/lib/organizations/guard', () => ({
  requireEditor: mocks.editor,
  requireActiveOrganization: mocks.member,
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
import { saveDealerReturn, withdrawDealerReturn } from './actions'
import { idleState } from '../../../../lib/forms'
const id = '27000000-0000-4000-8000-000000000001'
function form() {
  const data = new FormData()
  Object.entries({
    organization_id: 'untrusted',
    request_id: id,
    return_id: id,
    item_code: 'A',
    source_code: 'B',
    location_code: 'H',
    unit: 'EA',
    quantity: '999999999999999.999',
    requested_date: '2026-10-24',
    condition: 'unknown',
    reason: 'Return',
    sale_reference: '',
    confirmed: 'on',
  }).forEach(([k, v]) => data.set(k, v))
  return data
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.editor.mockResolvedValue({ ok: true, organizationId: 'guarded' })
  mocks.member.mockResolvedValue({ ok: true, organizationId: 'guarded' })
  mocks.rpc.mockResolvedValue({ data: id, error: null })
})
it('saves exact evidence under guarded organization and stable key', async () => {
  await expect(saveDealerReturn(idleState, form())).rejects.toThrow(
    `REDIRECT /replenishment/returns/${id}`,
  )
  expect(mocks.rpc).toHaveBeenCalledWith(
    'dealer_return_save',
    expect.objectContaining({
      p_organization_id: 'guarded',
      p_request_id: id,
      p_input: expect.objectContaining({
        quantity: '999999999999999.999',
        confirmed: true,
        sale_reference: null,
      }),
    }),
  )
})
it('retains entered values and field errors for invalid declarations without writing', async () => {
  const data = form()
  data.set('quantity', '0.0001')
  data.delete('confirmed')
  expect(await saveDealerReturn(idleState, data)).toMatchObject({
    status: 'error',
    values: { quantity: '0.0001' },
    fieldErrors: { quantity: 'invalidField', confirmed: 'invalidField' },
  })
  data.set('request_id', 'bad')
  expect(await saveDealerReturn(idleState, data)).toMatchObject({ code: 'validation' })
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('checks current editor and organization before a save or retry', async () => {
  mocks.editor.mockResolvedValue({
    ok: false,
    state: { status: 'error', code: 'stale_organization' },
  })
  expect(await saveDealerReturn(idleState, form())).toMatchObject({ code: 'stale_organization' })
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('requires current membership for withdrawal and leaves author enforcement to the RPC', async () => {
  await expect(withdrawDealerReturn(idleState, form())).rejects.toThrow(
    `REDIRECT /replenishment/returns/${id}`,
  )
  expect(mocks.member).toHaveBeenCalled()
  expect(mocks.editor).not.toHaveBeenCalled()
  expect(mocks.rpc).toHaveBeenCalledWith('dealer_return_withdraw', {
    p_organization_id: 'guarded',
    p_return_id: id,
    p_reason: 'Return',
  })
})
it('rejects malformed withdrawal and stale membership without writes', async () => {
  const data = form()
  data.set('reason', ' ')
  expect(await withdrawDealerReturn(idleState, data)).toMatchObject({ code: 'validation' })
  mocks.member.mockResolvedValue({
    ok: false,
    state: { status: 'error', code: 'stale_organization' },
  })
  expect(await withdrawDealerReturn(idleState, form())).toMatchObject({
    code: 'stale_organization',
  })
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('does not expose raw errors or revalidate failed mutations', async () => {
  for (const code of ['MQ403', 'MQ404', 'MQ409', 'MQ422']) {
    mocks.rpc.mockResolvedValue({ error: { code, message: 'private evidence' } })
    for (const action of [saveDealerReturn, withdrawDealerReturn]) {
      const result = await action(idleState, form())
      expect(result).toMatchObject({ status: 'error', code })
      expect(JSON.stringify(result)).not.toContain('private evidence')
    }
  }
  expect(mocks.revalidate).not.toHaveBeenCalled()
})
