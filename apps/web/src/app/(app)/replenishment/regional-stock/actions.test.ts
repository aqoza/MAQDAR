import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ editor: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/forms', () => import('../../../../lib/forms'))
vi.mock('@/lib/regional-stock', () => import('../../../../lib/regional-stock'))
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
import { previewRegionalStock, saveRegionalStock } from './actions'
import { idleState } from '../../../../lib/forms'
const id = '24000000-0000-4000-8000-000000000001'
const input = {
  item_code: 'ITEM',
  assessment_name: 'Regional',
  unit: 'EA',
  as_of: '2026-01-01',
  location_codes: ['A', 'B'],
  confirmed: true,
}
function form(payload: unknown = input) {
  const data = new FormData()
  Object.entries({
    organization_id: 'untrusted',
    input: JSON.stringify(payload),
    request_id: id,
    fingerprint: 'a'.repeat(64),
  }).forEach(([k, v]) => data.set(k, v))
  return data
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.editor.mockResolvedValue({ ok: true, organizationId: 'guarded-org' })
  mocks.rpc.mockResolvedValue({ data: id, error: null })
})
it('uses guarded organization, exact strings and confirmation', async () => {
  await expect(saveRegionalStock(idleState, form())).rejects.toThrow(
    `REDIRECT /replenishment/regional-stock/${id}`,
  )
  expect(mocks.rpc).toHaveBeenCalledWith('regional_stock_save', {
    p_organization_id: 'guarded-org',
    p_input: input,
    p_request_id: id,
    p_fingerprint: 'a'.repeat(64),
  })
})
it('denies malformed, oversized and unconfirmed input before database calls', async () => {
  for (const payload of [
    null,
    { ...input, confirmed: false },
    { ...input, location_codes: ['A'] },
    { ...input, assessment_name: 'x'.repeat(8193) },
  ]) {
    expect(await saveRegionalStock(idleState, form(payload))).toMatchObject({
      status: 'error',
    })
  }
  const data = form()
  data.set('input', '{bad json')
  expect(await previewRegionalStock(idleState, data)).toMatchObject({ status: 'error' })
  data.set('input', JSON.stringify(input))
  data.set('request_id', 'bad')
  expect(await saveRegionalStock(idleState, data)).toMatchObject({ status: 'error' })
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('rechecks editor and active-organization authority for preview and save', async () => {
  mocks.editor.mockResolvedValue({
    ok: false,
    state: { status: 'error', code: 'stale_organization' },
  })
  expect(await previewRegionalStock(idleState, form())).toMatchObject({
    code: 'stale_organization',
  })
  expect(await saveRegionalStock(idleState, form())).toMatchObject({
    code: 'stale_organization',
  })
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('returns safe messages for changed evidence and authorization failures', async () => {
  for (const code of ['MQ422', 'MQ409', 'MQ403', 'MQ404']) {
    mocks.rpc.mockResolvedValue({ error: { code, message: 'private source evidence' } })
    for (const action of [previewRegionalStock, saveRegionalStock]) {
      const result = await action(idleState, form())
      expect(result.status).toBe('error')
      expect(JSON.stringify(result)).not.toContain('private')
    }
  }
  expect(mocks.revalidate).not.toHaveBeenCalled()
})
