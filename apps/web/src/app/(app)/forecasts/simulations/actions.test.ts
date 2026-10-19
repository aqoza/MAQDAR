import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('@/lib/forms', () => import('../../../../lib/forms'))
vi.mock('@/lib/policy-simulation', () => import('../../../../lib/policy-simulation'))
vi.mock('@/lib/policy-sensitivity', () => import('../../../../lib/policy-sensitivity'))
const mocks = vi.hoisted(() => ({ guard: vi.fn(), rpc: vi.fn(), redirect: vi.fn() }))
vi.mock('@/lib/organizations/guard', () => ({
  requireEditor: mocks.guard,
  invalidState: async () => ({ status: 'error', code: 'validation' }),
  rpcErrorState: async () => ({ status: 'error', code: 'rejected' }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
import { enqueueSimulation, enqueueSensitivity } from './actions'
import { idleState } from '../../../../lib/forms'
const values = {
  organization_id: 'untrusted',
  policy_id: '12345678-1234-4234-8234-123456789000',
  request_id: '12345678-1234-4234-8234-123456789001',
  to_date: '2026-10-03',
  opening_stock: '999999999999999.999',
  alternative_maximum: '0',
  history_confirmed: 'on',
  empty_start_confirmed: 'on',
}
function form() {
  const data = new FormData()
  Object.entries(values).forEach(([key, value]) => data.set(key, value))
  return data
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.guard.mockResolvedValue({ ok: true, organizationId: 'session-org' })
  mocks.rpc.mockResolvedValue({ data: 'saved-run', error: null })
  mocks.redirect.mockImplementation(() => {
    throw new Error('REDIRECT')
  })
})
it('uses the current organization and preserves exact quantities', async () => {
  await expect(enqueueSimulation(idleState, form())).rejects.toThrow('REDIRECT')
  expect(mocks.rpc).toHaveBeenCalledWith(
    'simulation_enqueue',
    expect.objectContaining({
      p_organization_id: 'session-org',
      p_opening_stock: values.opening_stock,
      p_history_confirmed: true,
      p_empty_start_confirmed: true,
    }),
  )
  expect(mocks.redirect).toHaveBeenCalledWith('/forecasts/simulations/saved-run')
})
it('rejects missing confirmations and stale organization before RPC', async () => {
  const input = form()
  input.delete('empty_start_confirmed')
  expect((await enqueueSimulation(idleState, input)).code).toBe('validation')
  mocks.guard.mockResolvedValue({
    ok: false,
    state: { status: 'error', code: 'stale_organization' },
  })
  expect((await enqueueSimulation(idleState, form())).code).toBe('stale_organization')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('does not expose raw database details or redirect a failed submission', async () => {
  mocks.rpc.mockResolvedValue({ error: { message: 'private database detail' } })
  expect((await enqueueSimulation(idleState, form())).code).toBe('rejected')
  expect(mocks.redirect).not.toHaveBeenCalled()
})

function comparisonForm() {
  const data = new FormData()
  Object.entries({
    organization_id: 'untrusted',
    source_run_id: values.policy_id,
    request_id: values.request_id,
    maxima: '08.000,0.001,999999999999999.999',
    reuse_confirmed: 'on',
  }).forEach(([key, value]) => data.set(key, value))
  return data
}
it('queues canonical comparison inputs under current editor organization', async () => {
  await expect(enqueueSensitivity(idleState, comparisonForm())).rejects.toThrow('REDIRECT')
  expect(mocks.rpc).toHaveBeenCalledWith('simulation_sensitivity_enqueue', {
    p_organization_id: 'session-org',
    p_source_run_id: values.policy_id,
    p_request_id: values.request_id,
    p_alternative_maxima: ['0.001', '8', '999999999999999.999'],
    p_reuse_confirmed: true,
  })
})
it('rejects duplicate alternatives, missing reuse confirmation and stale authority before RPC', async () => {
  const input = comparisonForm()
  input.set('maxima', '8,08.00')
  expect((await enqueueSensitivity(idleState, input)).code).toBe('validation')
  input.set('maxima', '8')
  input.delete('reuse_confirmed')
  expect((await enqueueSensitivity(idleState, input)).code).toBe('validation')
  mocks.guard.mockResolvedValue({
    ok: false,
    state: { status: 'error', code: 'stale_organization' },
  })
  expect((await enqueueSensitivity(idleState, comparisonForm())).code).toBe('stale_organization')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('preserves comparison fields and hides database errors on rejected requests', async () => {
  mocks.rpc.mockResolvedValue({ error: { message: 'private database detail' } })
  const result = await enqueueSensitivity(idleState, comparisonForm())
  expect(result.code).toBe('rejected')
  expect(result.values?.maxima).toBe('08.000,0.001,999999999999999.999')
  expect(mocks.redirect).not.toHaveBeenCalled()
})
