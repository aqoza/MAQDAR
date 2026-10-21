import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ editor: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/forms', () => import('../../../../lib/forms'))
vi.mock('@/lib/driver-forecast', () => import('../../../../lib/driver-forecast'))
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
import { enqueueDriverForecast } from './forecast-actions'
import { idleState } from '../../../../lib/forms'
const id = '99000000-0000-4000-8000-000000000001'
function form() {
  const data = new FormData()
  Object.entries({
    organization_id: 'untrusted',
    forecast_id: id,
    dataset_id: id,
    request_id: id,
    confirmed: 'on',
  }).forEach(([k, v]) => data.set(k, v))
  return data
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.editor.mockResolvedValue({ ok: true, organizationId: 'guarded-org' })
  mocks.rpc.mockResolvedValue({ data: id, error: null })
})
it('uses current guarded organization and explicit source identities', async () => {
  await expect(enqueueDriverForecast(idleState, form())).rejects.toThrow('REDIRECT /forecasts')
  expect(mocks.rpc).toHaveBeenCalledWith('forecast_driver_enqueue', {
    p_organization_id: 'guarded-org',
    p_forecast_id: id,
    p_dataset_id: id,
    p_request_id: id,
    p_confirmed: true,
  })
})
it('does not queue unconfirmed, malformed or unauthorized requests', async () => {
  const data = form()
  data.delete('confirmed')
  expect(await enqueueDriverForecast(idleState, data)).toMatchObject({
    status: 'error',
    message: 'confirmationRequired',
  })
  data.set('confirmed', 'on')
  data.set('dataset_id', 'bad')
  expect(await enqueueDriverForecast(idleState, data)).toMatchObject({
    status: 'error',
    code: 'validation',
  })
  mocks.editor.mockResolvedValue({
    ok: false,
    state: { status: 'error', code: 'stale_organization' },
  })
  expect(await enqueueDriverForecast(idleState, form())).toMatchObject({
    code: 'stale_organization',
  })
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('sanitizes incompatible source, conflict and access failures', async () => {
  for (const code of ['MQ422', 'MQ409', 'MQ403']) {
    mocks.rpc.mockResolvedValue({ error: { code, message: 'private source evidence' } })
    const result = await enqueueDriverForecast(idleState, form())
    expect(JSON.stringify(result)).not.toContain('private')
    expect(result.status).toBe('error')
  }
  expect(mocks.revalidate).not.toHaveBeenCalled()
})
