import { expect, it } from 'vitest'
import messages from '../../messages/en.json'
import {
  canSaveTransferDates,
  transferDateInputSchema,
  transferDateListParams,
  transferDateParams,
  transferDateRpcInput,
  transferDateSaveSchema,
  transferDateStatuses,
} from './transfer-dates'

const id = 'a8100000-0000-4000-8000-000000000001'
const input = { draft: id, requested: '2026-10-10', confirmed: 'true' as const }

it('rejects invalid dates, out-of-range dates and ambiguous confirmations', () => {
  for (const requested of [
    '2026-02-30',
    '1899-12-31',
    '2101-01-01',
    'infinity',
    '2026-10-10T00:00:00Z',
  ]) {
    expect(transferDateInputSchema.safeParse({ ...input, requested }).success).toBe(false)
  }
  for (const confirmed of [true, 'yes', undefined]) {
    expect(transferDateInputSchema.safeParse({ ...input, confirmed }).success).toBe(false)
  }
  expect(transferDateInputSchema.safeParse({ ...input, draft: 'invalid' }).success).toBe(false)
  expect(transferDateInputSchema.safeParse({ ...input, confirmed: 'false' }).success).toBe(true)
})

it('binds saves to a valid request and a lowercase evidence fingerprint', () => {
  const save = { ...input, request_id: id, fingerprint: 'a'.repeat(64) }
  expect(transferDateSaveSchema.safeParse(save).success).toBe(true)
  expect(transferDateSaveSchema.safeParse({ ...save, fingerprint: 'A'.repeat(64) }).success).toBe(
    false,
  )
  expect(transferDateSaveSchema.safeParse({ ...save, request_id: '' }).success).toBe(false)
})

it('defaults missing confirmation to false and maps only explicit RPC inputs', () => {
  expect(transferDateParams({ draft: [id, 'ignored'], requested: input.requested })).toEqual({
    ...input,
    confirmed: 'false',
  })
  expect(transferDateRpcInput(input)).toEqual({
    p_redistribution_id: id,
    p_requested_date: input.requested,
    p_calendars_confirmed: true,
  })
  expect(transferDateRpcInput({ ...input, confirmed: 'false' }).p_calendars_confirmed).toBe(false)
})

it('only offers saving resolved dates or a zero-quantity no-transfer result', () => {
  for (const status of transferDateStatuses) {
    expect(canSaveTransferDates(status)).toBe(['available', 'no_transfer_needed'].includes(status))
    expect(messages.TransferDates.statuses[status]).toBeTruthy()
  }
})

it('rejects malformed parent filters and unsupported ordering', () => {
  expect(transferDateListParams({ draft: id }).filters.draft).toBe(id)
  const params = transferDateListParams({ draft: 'invalid', sort: 'report', dir: 'unknown' })
  expect(params.filters.draft).toBeUndefined()
  expect(params.sort).toBe('created_at')
  expect(params.dir).toBe('desc')
})
