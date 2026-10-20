import { expect, it } from 'vitest'
import messages from '../../messages/en.json'
import {
  canSaveNetworkFreight,
  networkFreightInputSchema,
  networkFreightSaveSchema,
  networkFreightParams,
  networkFreightRpcInput,
  networkFreightListParams,
  networkFreightReportSchema,
} from './network-freight'

const id = 'a8100000-0000-4000-8000-000000000001'
it('validates source, confirmation and retry identity before mapping RPC input', () => {
  const input = { scenario: id, confirmed: 'true' as const }
  expect(networkFreightParams({ scenario: [id, 'ignored'] })).toEqual({
    scenario: id,
    confirmed: 'false',
  })
  expect(networkFreightRpcInput(input)).toEqual({ p_scenario_id: id, p_terms_confirmed: true })
  for (const confirmed of [true, 'yes', undefined])
    expect(networkFreightInputSchema.safeParse({ ...input, confirmed }).success).toBe(false)
  expect(
    networkFreightSaveSchema.safeParse({ ...input, request_id: id, fingerprint: 'a'.repeat(64) })
      .success,
  ).toBe(true)
  expect(
    networkFreightSaveSchema.safeParse({ ...input, request_id: '', fingerprint: 'A'.repeat(64) })
      .success,
  ).toBe(false)
})
it('only offers saving complete estimates or no-transfer results', () => {
  for (const status of networkFreightReportSchema.shape.status.options) {
    expect(canSaveNetworkFreight(status)).toBe(['available', 'no_transfer_needed'].includes(status))
    expect(messages.NetworkFreight.statuses[status]).toBeTruthy()
  }
})
it('preserves exact aggregate decimal strings and rejects floating totals', () => {
  const total = { currency: 'KWD', minor_units: 3, subtotal: '19999999999999999.980' }
  expect(networkFreightReportSchema.shape.totals.parse([total])).toEqual([total])
  expect(
    networkFreightReportSchema.shape.totals.safeParse([{ ...total, subtotal: 1.23 }]).success,
  ).toBe(false)
  expect(
    networkFreightReportSchema.shape.totals.safeParse([{ ...total, minor_units: 4 }]).success,
  ).toBe(false)
})
it('rejects malformed history filters and unsupported sorting', () => {
  expect(networkFreightListParams({ scenario: id }).filters.scenario).toBe(id)
  const parsed = networkFreightListParams({ scenario: 'bad', sort: 'report', dir: 'bad' })
  expect(parsed.filters.scenario).toBeUndefined()
  expect(parsed.sort).toBe('created_at')
})
