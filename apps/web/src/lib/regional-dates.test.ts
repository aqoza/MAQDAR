import { describe, expect, it } from 'vitest'
import {
  canSaveRegionalDates,
  regionalDateInputSchema,
  regionalDateParams,
  regionalDateRpcInput,
  regionalDateSaveSchema,
} from './regional-dates'

const id = '00000000-0000-4000-8000-000000000001'
describe('regional date requests', () => {
  it('requires a parent, real bounded date and explicit confirmation value', () => {
    const input = { sourcing: id, requested: '2026-10-10', confirmed: 'true' }
    expect(regionalDateInputSchema.parse(input)).toEqual(input)
    for (const requested of ['2026-02-30', '1899-12-31', '2101-01-01', 'infinity']) {
      expect(regionalDateInputSchema.safeParse({ ...input, requested }).success).toBe(false)
    }
    expect(regionalDateInputSchema.safeParse({ ...input, sourcing: 'bad' }).success).toBe(false)
    expect(regionalDateInputSchema.safeParse({ ...input, confirmed: undefined }).success).toBe(
      false,
    )
  })
  it('defaults omitted confirmation to false and isolates repeated query values', () => {
    expect(
      regionalDateParams({ sourcing: [id, 'ignored'], requested: ['2026-10-10', 'ignored'] }),
    ).toEqual({ sourcing: id, requested: '2026-10-10', confirmed: 'false' })
    expect(
      regionalDateRpcInput({ sourcing: id, requested: '2026-10-10', confirmed: 'false' }),
    ).toEqual({ p_sourcing_id: id, p_requested_date: '2026-10-10', p_calendars_confirmed: false })
  })
  it('requires retry identity and fingerprint; only complete/no-transfer reports save', () => {
    const input = {
      sourcing: id,
      requested: '2026-10-10',
      confirmed: 'false',
      request_id: id,
      fingerprint: 'a'.repeat(64),
    }
    expect(regionalDateSaveSchema.safeParse(input).success).toBe(true)
    expect(regionalDateSaveSchema.safeParse({ ...input, fingerprint: 'bad' }).success).toBe(false)
    expect(canSaveRegionalDates('available')).toBe(true)
    expect(canSaveRegionalDates('no_transfer_needed')).toBe(true)
    expect(canSaveRegionalDates('line_unavailable')).toBe(false)
    expect(canSaveRegionalDates('destination_policy_unavailable')).toBe(false)
  })
})
