import { expect, it } from 'vitest'
import {
  eventDraftFormValues,
  eventDraftInputSchema,
  eventDraftSaveSchema,
} from './event-replenishment'
const id = '99200000-0000-4000-8000-000000000001'
const valid = {
  scenario_id: id,
  backorders: '0',
  orders_confirmed: true,
  event_uncommitted: true,
  request_id: id,
  fingerprint: 'a'.repeat(64),
}
it('normalizes entered quantities without a floating point conversion or client threshold', () => {
  expect(
    eventDraftInputSchema.parse({ ...valid, backorders: '٩٩٩,٩٩٩,٩٩٩,٩٩٩,٩٩٩.٩٩٩', maximum: '1' }),
  ).toEqual({
    scenario_id: id,
    backorders: '999999999999999.999',
    orders_confirmed: true,
    event_uncommitted: true,
  })
})
it.each([
  { scenario_id: 'bad' },
  { backorders: '-1' },
  { backorders: '' },
  { backorders: '1.0001' },
  { backorders: '1000000000000000' },
  { orders_confirmed: null },
  { event_uncommitted: 'true' },
  { request_id: '' },
  { fingerprint: 'bad' },
])('rejects invalid inputs %j', (change) => {
  expect(eventDraftSaveSchema.safeParse({ ...valid, ...change }).success).toBe(false)
})
it('unchecked confirmations remain false and unexpected calculation fields are ignored', () => {
  const form = new FormData()
  Object.entries({
    scenario_id: id,
    backorders: '0',
    maximum: '999',
    orders_confirmed: 'on',
  }).forEach(([k, v]) => form.set(k, v))
  expect(eventDraftInputSchema.parse(eventDraftFormValues(form))).toEqual({
    scenario_id: id,
    backorders: '0',
    orders_confirmed: false,
    event_uncommitted: false,
  })
})
