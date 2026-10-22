import { expect, it } from 'vitest'
import messages from '../../messages/en.json'
import arabic from '../../messages/ar.json'
import {
  canSaveRegionalFreight,
  regionalFreightInputSchema,
  regionalFreightSaveSchema,
  regionalFreightParams,
  regionalFreightRpcInput,
  regionalFreightListParams,
  regionalFreightReportSchema,
} from './regional-freight'

const id = 'a8100000-0000-4000-8000-000000000001'
it('validates source, confirmation and retry identity before mapping RPC input', () => {
  const input = { scenario: id, confirmed: 'true' as const }
  expect(regionalFreightParams({ scenario: [id, 'ignored'] })).toEqual({
    scenario: id,
    confirmed: 'false',
  })
  expect(regionalFreightRpcInput(input)).toEqual({ p_scenario_id: id, p_terms_confirmed: true })
  for (const confirmed of [true, 'yes', undefined])
    expect(regionalFreightInputSchema.safeParse({ ...input, confirmed }).success).toBe(false)
  expect(
    regionalFreightSaveSchema.safeParse({ ...input, request_id: id, fingerprint: 'a'.repeat(64) })
      .success,
  ).toBe(true)
  expect(
    regionalFreightSaveSchema.safeParse({ ...input, request_id: '', fingerprint: 'A'.repeat(64) })
      .success,
  ).toBe(false)
})
it('only offers saving complete estimates or no-transfer results', () => {
  for (const status of regionalFreightReportSchema.shape.status.options) {
    expect(canSaveRegionalFreight(status)).toBe(
      ['available', 'no_transfer_needed'].includes(status),
    )
    expect(messages.RegionalFreight.statuses[status]).toBeTruthy()
  }
})
it('preserves exact aggregate decimal strings and rejects floating totals', () => {
  const total = { currency: 'KWD', minor_units: 3, subtotal: '19999999999999999.980' }
  expect(regionalFreightReportSchema.shape.totals.parse([total])).toEqual([total])
  expect(
    regionalFreightReportSchema.shape.totals.safeParse([{ ...total, subtotal: 1.23 }]).success,
  ).toBe(false)
  expect(
    regionalFreightReportSchema.shape.totals.safeParse([{ ...total, minor_units: 4 }]).success,
  ).toBe(false)
})
it('rejects malformed history filters and unsupported sorting', () => {
  expect(regionalFreightListParams({ scenario: id }).filters.scenario).toBe(id)
  const parsed = regionalFreightListParams({ scenario: 'bad', sort: 'report', dir: 'bad' })
  expect(parsed.filters.scenario).toBeUndefined()
  expect(parsed.sort).toBe('created_at')
})

it('has Arabic report states and preserves per-source date evidence', () => {
  for (const status of regionalFreightReportSchema.shape.status.options)
    expect(arabic.RegionalFreight.statuses[status]).toBeTruthy()
  for (const status of regionalFreightReportSchema.shape.lines.element.shape.status.options)
    expect(arabic.RegionalFreight.labels.statuses[status]).toBeTruthy()
  const date = regionalFreightReportSchema.shape.lines.element.shape.dispatch_date
  expect(date.parse('2026-10-12')).toBe('2026-10-12')
  expect(date.parse(null)).toBeNull()
  expect(date.safeParse('2026-02-30').success).toBe(false)
})
