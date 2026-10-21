import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ editor: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/forms', () => import('../../../../lib/forms'))
vi.mock('@/lib/installed-base', () => import('../../../../lib/installed-base'))
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
import { previewPopulation, savePopulation } from './actions'
import { idleState } from '../../../../lib/forms'
const id = '24000000-0000-4000-8000-000000000001'
const input = {
  item_code: 'P1',
  location_code: 'L1',
  dataset_name: 'Population',
  unit: 'EA',
  source: 'Synthetic source',
  as_of: '2026-01-01',
  available_on: '2026-01-02',
  confirmed: true,
  non_overlapping: true,
  rows: [
    {
      group_code: 'A',
      group_name: 'Group',
      installed_on: null,
      active_assets: '0',
      parts_per_asset: '0.001',
    },
  ],
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
it('uses guarded organization, exact strings and both confirmations', async () => {
  await expect(savePopulation(idleState, form())).rejects.toThrow(
    `REDIRECT /forecasts/installed-base/${id}`,
  )
  expect(mocks.rpc).toHaveBeenCalledWith('installed_base_save', {
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
    { ...input, non_overlapping: false },
    { ...input, rows: [{ ...input.rows[0], active_assets: 1 }] },
    { ...input, source: 'x'.repeat(524289) },
  ]) {
    expect(await savePopulation(idleState, form(payload))).toMatchObject({ status: 'error' })
  }
  const data = form()
  data.set('input', '{bad json')
  expect(await previewPopulation(idleState, data)).toMatchObject({ status: 'error' })
  data.set('input', JSON.stringify(input))
  data.set('request_id', 'bad')
  expect(await savePopulation(idleState, data)).toMatchObject({ status: 'error' })
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('rechecks editor and active-organization authority for preview and save', async () => {
  mocks.editor.mockResolvedValue({
    ok: false,
    state: { status: 'error', code: 'stale_organization' },
  })
  expect(await previewPopulation(idleState, form())).toMatchObject({ code: 'stale_organization' })
  expect(await savePopulation(idleState, form())).toMatchObject({ code: 'stale_organization' })
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('returns safe messages for changed evidence and authorization failures', async () => {
  for (const code of ['MQ422', 'MQ409', 'MQ403', 'MQ404']) {
    mocks.rpc.mockResolvedValue({ error: { code, message: 'private source evidence' } })
    for (const action of [previewPopulation, savePopulation]) {
      const result = await action(idleState, form())
      expect(result.status).toBe('error')
      expect(JSON.stringify(result)).not.toContain('private')
    }
  }
  expect(mocks.revalidate).not.toHaveBeenCalled()
})
