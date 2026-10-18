import { expect, it } from 'vitest'
import messages from '../../messages/en.json'
import { networkLinkSchema } from './master-data/entities/network-links'
import {
  canSaveTransferFreight,
  transferFreightInputSchema,
  transferFreightSaveSchema,
  transferFreightParams,
  transferFreightRpcInput,
  transferFreightListParams,
  transferFreightStatuses,
} from './transfer-freight'

const id = 'a8100000-0000-4000-8000-000000000001'
const input = { scenario: id, confirmed: 'true' as const }
it('requires an explicit unambiguous confirmation and valid source identity', () => {
  for (const confirmed of [true, 'yes', undefined])
    expect(transferFreightInputSchema.safeParse({ ...input, confirmed }).success).toBe(false)
  expect(transferFreightInputSchema.safeParse({ ...input, scenario: 'invalid' }).success).toBe(
    false,
  )
  expect(transferFreightParams({ scenario: [id, 'ignored'] })).toEqual({
    ...input,
    confirmed: 'false',
  })
  expect(transferFreightRpcInput(input)).toEqual({ p_scenario_id: id, p_terms_confirmed: true })
})
it('binds saving to a request UUID and exact fingerprint', () => {
  const save = { ...input, request_id: id, fingerprint: 'a'.repeat(64) }
  expect(transferFreightSaveSchema.safeParse(save).success).toBe(true)
  expect(
    transferFreightSaveSchema.safeParse({ ...save, fingerprint: 'A'.repeat(64) }).success,
  ).toBe(false)
  expect(transferFreightSaveSchema.safeParse({ ...save, request_id: '' }).success).toBe(false)
})
it('offers saving only a priced or no-transfer result and explains every unavailable status', () => {
  for (const status of transferFreightStatuses) {
    expect(canSaveTransferFreight(status)).toBe(
      ['available', 'no_transfer_needed'].includes(status),
    )
    expect(messages.TransferFreight.statuses[status]).toBeTruthy()
  }
})
it('rejects malformed parent filters and unsupported ordering', () => {
  expect(transferFreightListParams({ scenario: id }).filters.scenario).toBe(id)
  const parsed = transferFreightListParams({ scenario: 'bad', sort: 'report', dir: 'bad' })
  expect(parsed.filters.scenario).toBeUndefined()
  expect(parsed.sort).toBe('created_at')
})
it('allows unknown lane provenance but rejects invalid supplied evidence', () => {
  const lane = {
    from_location_id: id,
    to_location_id: 'a8100000-0000-4000-8000-000000000002',
    lead_time_days_p50: '2',
    lead_time_days_p90: '4',
    freight_basis: 'per_unit',
    freight_cost: '1.234',
    currency: 'SAR',
    is_active: true,
  }
  expect(networkLinkSchema.parse(lane)).toMatchObject({
    freight_unit: null,
    freight_valid_from: null,
  })
  expect(
    networkLinkSchema.parse({ ...lane, freight_unit: 'EA', freight_valid_from: '2026-10-01' }),
  ).toMatchObject({ freight_unit: 'EA', freight_valid_from: '2026-10-01' })
  expect(networkLinkSchema.safeParse({ ...lane, freight_unit: 'BOX' }).success).toBe(false)
  expect(networkLinkSchema.safeParse({ ...lane, freight_valid_from: 'infinity' }).success).toBe(
    false,
  )
})
