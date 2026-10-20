import { describe, expect, it } from 'vitest'
import {
  canSaveNetworkDates,
  networkDateInputSchema,
  networkDateParams,
  networkDateRpcInput,
  networkDateSaveSchema,
} from './network-dates'

const id = '00000000-0000-4000-8000-000000000001'
describe('network date requests', () => {
  it('requires a parent, real bounded date and explicit confirmation value', () => {
    const input = { allocation: id, requested: '2026-10-10', confirmed: 'true' }
    expect(networkDateInputSchema.parse(input)).toEqual(input)
    for (const requested of ['2026-02-30', '1899-12-31', '2101-01-01', 'infinity']) {
      expect(networkDateInputSchema.safeParse({ ...input, requested }).success).toBe(false)
    }
    expect(networkDateInputSchema.safeParse({ ...input, allocation: 'bad' }).success).toBe(false)
    expect(networkDateInputSchema.safeParse({ ...input, confirmed: undefined }).success).toBe(false)
  })
  it('defaults omitted confirmation to false and isolates repeated query values', () => {
    expect(
      networkDateParams({ allocation: [id, 'ignored'], requested: ['2026-10-10', 'ignored'] }),
    ).toEqual({ allocation: id, requested: '2026-10-10', confirmed: 'false' })
    expect(
      networkDateRpcInput({ allocation: id, requested: '2026-10-10', confirmed: 'false' }),
    ).toEqual({ p_allocation_id: id, p_requested_date: '2026-10-10', p_calendars_confirmed: false })
  })
  it('requires retry identity and fingerprint; only complete/no-transfer reports save', () => {
    const input = {
      allocation: id,
      requested: '2026-10-10',
      confirmed: 'false',
      request_id: id,
      fingerprint: 'a'.repeat(64),
    }
    expect(networkDateSaveSchema.safeParse(input).success).toBe(true)
    expect(networkDateSaveSchema.safeParse({ ...input, fingerprint: 'bad' }).success).toBe(false)
    expect(canSaveNetworkDates('available')).toBe(true)
    expect(canSaveNetworkDates('no_transfer_needed')).toBe(true)
    expect(canSaveNetworkDates('line_unavailable')).toBe(false)
    expect(canSaveNetworkDates('dispatch_unavailable')).toBe(false)
  })
})
