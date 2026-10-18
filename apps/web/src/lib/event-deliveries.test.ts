import { expect, it } from 'vitest'
import {
  eventDeliveryInputSchema,
  eventDeliverySaveSchema,
  eventDeliveryFormValues,
  isZeroQuantity,
  isSaveableDelivery,
} from './event-deliveries'
const id = '45fccdfa-6816-12b4-6722-8b9776fc6925'
const valid = {
  scenario_id: id,
  requested_date: '2026-10-10',
  calendars_confirmed: true,
  request_id: '99200000-0000-4000-8000-000000000001',
  fingerprint: 'a'.repeat(64),
}
it('accepts PostgreSQL identifiers but only strict retry UUIDs and ignores submitted dates/quantities', () => {
  expect(
    eventDeliveryInputSchema.parse({ ...valid, quantity: '999', receipt_date: '2030-01-01' }),
  ).toEqual({ scenario_id: id, requested_date: '2026-10-10', calendars_confirmed: true })
  expect(eventDeliverySaveSchema.safeParse({ ...valid, request_id: id }).success).toBe(false)
})
it.each([
  { scenario_id: 'bad' },
  { requested_date: '2026-02-30' },
  { requested_date: 'infinity' },
  { requested_date: '1899-12-31' },
  { requested_date: '2101-01-01' },
  { calendars_confirmed: 'true' },
  { request_id: 'bad' },
  { fingerprint: 'bad' },
])('rejects invalid %j', (change) =>
  expect(eventDeliverySaveSchema.safeParse({ ...valid, ...change }).success).toBe(false),
)
it('keeps unchecked calendar applicability false', () => {
  const form = new FormData()
  form.set('scenario_id', id)
  form.set('requested_date', '2026-10-10')
  form.set('calendars_confirmed', 'on')
  expect(eventDeliveryInputSchema.parse(eventDeliveryFormValues(form)).calendars_confirmed).toBe(
    false,
  )
})
it('allows only resolved schedules or explicit no-order outcomes to save', () => {
  expect(isSaveableDelivery('available')).toBe(true)
  expect(isSaveableDelivery('no_order_needed')).toBe(true)
  expect(isSaveableDelivery('calendar_unknown')).toBe(false)
  expect(isSaveableDelivery('calendars_unconfirmed')).toBe(false)
})
it('does not mistake small positive or large exact quantities for no order', () => {
  expect(isZeroQuantity('0.000')).toBe(true)
  expect(isZeroQuantity('0.001')).toBe(false)
  expect(isZeroQuantity('999999999999999.999')).toBe(false)
})
