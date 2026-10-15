import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ guard: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/forms', () => import('../../../lib/forms'))
vi.mock('@/lib/planning', () => import('../../../lib/planning'))
vi.mock('@/lib/classification', () => import('../../../lib/classification'))
vi.mock('@/lib/forecasting', () => import('../../../lib/forecasting'))
vi.mock('@/lib/preparation', () => import('../../../lib/preparation'))
vi.mock('@/lib/prepared-forecast', () => import('../../../lib/prepared-forecast'))
vi.mock('@/lib/inventory-policy', () => import('../../../lib/inventory-policy'))
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
import { enqueueClassification } from './classify/actions'
import { enqueueForecast } from './new/actions'
import { enqueuePreparation } from './prepare/actions'
import { enqueuePreparedForecast } from './prepared/actions'
import { enqueuePolicy } from './policies/actions'
import { CLASSIFICATION_DEFAULTS } from '../../../lib/classification'
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
function policyForm() {
  const data = form()
  data.set('forecast_id', '70000000-0000-4000-8000-000000000002')
  data.set('lead_time', '14')
  data.set('review_interval', '7')
  data.set('service_percent', '95')
  return data
}
it('policy uses session organization and converts cycle service to a probability', async () => {
  await expect(enqueuePolicy(idleState, policyForm())).rejects.toThrow('REDIRECT')
  expect(mocks.rpc).toHaveBeenCalledWith(
    'policy_enqueue',
    expect.objectContaining({
      p_organization_id: 'session-org',
      p_lead_time: 14,
      p_review_interval: 7,
      p_service_level: 0.95,
    }),
  )
})
it('policy rejects stale organization and invalid parameters before enqueue', async () => {
  const data = policyForm()
  data.set('service_percent', '100')
  expect((await enqueuePolicy(idleState, data)).code).toBe('validation')
  data.set('service_percent', '95')
  data.set('lead_time', '89')
  expect((await enqueuePolicy(idleState, data)).code).toBe('validation')
  mocks.guard.mockResolvedValue({
    ok: false,
    state: { status: 'error', code: 'stale_organization' },
  })
  expect((await enqueuePolicy(idleState, policyForm())).code).toBe('stale_organization')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('policy returns a translated database rejection without raw details', async () => {
  mocks.rpc.mockResolvedValue({ error: { code: 'MQ422', message: 'private details' } })
  const result = await enqueuePolicy(idleState, policyForm())
  expect(result.code).toBe('MQ422')
  expect(JSON.stringify(result)).not.toContain('private')
})
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

function classificationForm() {
  const data = form()
  Object.entries(CLASSIFICATION_DEFAULTS).forEach(([k, v]) => data.set(k, v))
  data.set('history_complete', 'on')
  return data
}
it('requires explicit confirmation before sending a classification request', async () => {
  const data = classificationForm()
  data.delete('history_complete')
  expect((await enqueueClassification(idleState, data)).message).toBe('confirmationRequired')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('classification honors the editor and stale-organization guard', async () => {
  mocks.guard.mockResolvedValue({ ok: false, state: { status: 'error', code: 'forbidden' } })
  expect((await enqueueClassification(idleState, classificationForm())).code).toBe('forbidden')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('classification sends the session organization and approved thresholds', async () => {
  await expect(enqueueClassification(idleState, classificationForm())).rejects.toThrow('REDIRECT')
  expect(mocks.rpc).toHaveBeenCalledWith(
    'classification_enqueue',
    expect.objectContaining({
      p_organization_id: 'session-org',
      p_history_complete: true,
      p_options: CLASSIFICATION_DEFAULTS,
    }),
  )
})
it('rejects invalid classification thresholds before the RPC', async () => {
  const data = classificationForm()
  data.set('abc_a', '0.99')
  expect((await enqueueClassification(idleState, data)).code).toBe('validation')
  expect(mocks.rpc).not.toHaveBeenCalled()
})

function forecastForm() {
  const data = form()
  data.set('item_codes', 'PART-1\nPART-2')
  data.set('horizon', '28')
  data.set('history_complete', 'on')
  return data
}
function preparedForm() {
  const data = forecastForm()
  data.set('preparation_id', '70000000-0000-4000-8000-000000000002')
  data.set('fixed_group_confirmed', 'on')
  return data
}
it('prepared forecast requires fixed-group confirmation and valid saved identity/horizon', async () => {
  const data = preparedForm()
  data.delete('fixed_group_confirmed')
  expect((await enqueuePreparedForecast(idleState, data)).message).toBe('confirmationRequired')
  data.set('fixed_group_confirmed', 'on')
  data.set('preparation_id', 'malformed')
  expect((await enqueuePreparedForecast(idleState, data)).code).toBe('validation')
  data.set('preparation_id', '70000000-0000-4000-8000-000000000002')
  data.set('horizon', '91')
  expect((await enqueuePreparedForecast(idleState, data)).code).toBe('validation')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('prepared forecast uses session organization, saved identity and explicit confirmation', async () => {
  await expect(enqueuePreparedForecast(idleState, preparedForm())).rejects.toThrow('REDIRECT')
  expect(mocks.rpc).toHaveBeenCalledWith('forecast_prepared_enqueue', {
    p_organization_id: 'session-org',
    p_preparation_id: '70000000-0000-4000-8000-000000000002',
    p_request_id: '70000000-0000-4000-8000-000000000001',
    p_horizon: 28,
    p_fixed_group_confirmed: true,
  })
})
it('prepared forecast respects the shared editor guard and safe RPC errors', async () => {
  mocks.guard.mockResolvedValueOnce({
    ok: false,
    state: { status: 'error', code: 'stale_organization' },
  })
  expect((await enqueuePreparedForecast(idleState, preparedForm())).code).toBe('stale_organization')
  expect(mocks.rpc).not.toHaveBeenCalled()
  mocks.rpc.mockResolvedValue({ error: { code: 'MQ422', message: 'private internals' } })
  const result = await enqueuePreparedForecast(idleState, preparedForm())
  expect(result.code).toBe('MQ422')
  expect(JSON.stringify(result)).not.toContain('private internals')
})
it('preparation requires complete-history confirmation and bounded related-source selection', async () => {
  const data = forecastForm()
  data.delete('history_complete')
  expect((await enqueuePreparation(idleState, data)).message).toBe('confirmationRequired')
  data.set('history_complete', 'on')
  data.set('item_codes', Array.from({ length: 26 }, (_, i) => `P-${i}`).join('\n'))
  expect((await enqueuePreparation(idleState, data)).code).toBe('validation')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('preparation sends only session organization and its own parsed parameters', async () => {
  await expect(enqueuePreparation(idleState, forecastForm())).rejects.toThrow('REDIRECT')
  expect(mocks.rpc).toHaveBeenCalledWith(
    'preparation_enqueue',
    expect.objectContaining({
      p_organization_id: 'session-org',
      p_item_codes: ['PART-1', 'PART-2'],
      p_history_complete: true,
    }),
  )
})
it('preparation respects the shared stale-organization guard', async () => {
  mocks.guard.mockResolvedValue({
    ok: false,
    state: { status: 'error', code: 'stale_organization' },
  })
  expect((await enqueuePreparation(idleState, forecastForm())).code).toBe('stale_organization')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('expanded forecasts use their bounded RPC and reject excessive item selections', async () => {
  const data = forecastForm()
  data.set('method', 'expanded-v1')
  await expect(enqueueForecast(idleState, data)).rejects.toThrow('REDIRECT')
  expect(mocks.rpc).toHaveBeenCalledWith(
    'forecast_expanded_enqueue',
    expect.objectContaining({ p_organization_id: 'session-org' }),
  )
  mocks.rpc.mockClear()
  data.set('item_codes', Array.from({ length: 11 }, (_, i) => `PART-${i}`).join('\n'))
  expect((await enqueueForecast(idleState, data)).code).toBe('validation')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('forecast requires confirmation and valid item/horizon bounds before any RPC', async () => {
  const data = forecastForm()
  data.delete('history_complete')
  expect((await enqueueForecast(idleState, data)).message).toBe('confirmationRequired')
  data.set('history_complete', 'on')
  data.set('horizon', '91')
  expect((await enqueueForecast(idleState, data)).code).toBe('validation')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('forecast honors the shared editor and stale-organization guard', async () => {
  mocks.guard.mockResolvedValue({
    ok: false,
    state: { status: 'error', code: 'stale_organization' },
  })
  expect((await enqueueForecast(idleState, forecastForm())).code).toBe('stale_organization')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('forecast sends the session organization and parsed selection', async () => {
  await expect(enqueueForecast(idleState, forecastForm())).rejects.toThrow('REDIRECT')
  expect(mocks.rpc).toHaveBeenCalledWith(
    'forecast_enqueue',
    expect.objectContaining({
      p_organization_id: 'session-org',
      p_item_codes: ['PART-1', 'PART-2'],
      p_horizon: 28,
      p_history_complete: true,
    }),
  )
})
