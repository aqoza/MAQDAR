import { expect, it } from 'vitest'
import {
  eventCostInputSchema,
  eventCostSaveSchema,
  eventCostFormValues,
  isSaveableEventCost,
} from './event-costs'
import { formatPurchaseCost } from './purchase-costs'
const id = '45fccdfa-6816-12b4-6722-8b9776fc6925'
const valid = {
  delivery_id: id,
  price_confirmed: true,
  request_id: '99200000-0000-4000-8000-000000000001',
  fingerprint: 'a'.repeat(64),
}
it('accepts PostgreSQL resource identifiers and strict retry UUIDs, never submitted prices or amounts', () => {
  expect(eventCostInputSchema.parse({ ...valid, unit_price: '999', subtotal: '999' })).toEqual({
    delivery_id: id,
    price_confirmed: true,
  })
  expect(eventCostSaveSchema.safeParse({ ...valid, request_id: id }).success).toBe(false)
})
it.each([
  { delivery_id: 'bad' },
  { price_confirmed: 'true' },
  { price_confirmed: null },
  { request_id: 'bad' },
  { fingerprint: 'bad' },
])('rejects invalid %j', (change) =>
  expect(eventCostSaveSchema.safeParse({ ...valid, ...change }).success).toBe(false),
)
it('unchecked applicability remains false', () => {
  const form = new FormData()
  form.set('delivery_id', id)
  form.set('price_confirmed', 'on')
  expect(eventCostInputSchema.parse(eventCostFormValues(form)).price_confirmed).toBe(false)
})
it('saves only complete priced or no-order comparisons', () => {
  expect(isSaveableEventCost('available')).toBe(true)
  expect(isSaveableEventCost('no_order_needed')).toBe(true)
  for (const status of [
    'price_unconfirmed',
    'unit_unknown',
    'amount_out_of_range',
    'location_unavailable',
  ] as const)
    expect(isSaveableEventCost(status)).toBe(false)
})
it('retains large monetary precision and distinguishes unknown from zero', () => {
  expect(formatPurchaseCost('999999999999999.999', 'KWD', 3, 'en')).toContain(
    '999,999,999,999,999.999',
  )
  expect(formatPurchaseCost(null, 'SAR', 2, 'en')).toBe('—')
  expect(formatPurchaseCost('0.00', 'SAR', 2, 'en')).toContain('0.00')
})
