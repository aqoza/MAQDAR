import { expect, it } from 'vitest'
import {
  eventSupplierInputSchema,
  eventSupplierSaveSchema,
  eventSupplierFormValues,
} from './event-suppliers'
import { eventDraftInputSchema } from './event-replenishment'
const id = '45fccdfa-6816-12b4-6722-8b9776fc6925'
const request = '99200000-0000-4000-8000-000000000001'
const valid = {
  draft_id: id,
  supplier_code: 'SUP',
  terms_confirmed: true,
  request_id: request,
  fingerprint: 'a'.repeat(64),
}
it('accepts canonical database references while keeping strict retry tokens and ignoring client quantities', () => {
  expect(
    eventSupplierInputSchema.parse({ ...valid, supplier_code: ' SUP ', quantity: '999' }),
  ).toEqual({ draft_id: id, supplier_code: 'SUP', terms_confirmed: true })
  expect(eventSupplierSaveSchema.safeParse({ ...valid, request_id: id }).success).toBe(false)
  expect(
    eventDraftInputSchema.safeParse({
      scenario_id: id,
      backorders: '0',
      orders_confirmed: true,
      event_uncommitted: true,
    }).success,
  ).toBe(true)
})
it.each([
  { draft_id: 'bad' },
  { supplier_code: '' },
  { supplier_code: 'x'.repeat(65) },
  { supplier_code: 'SUP;delete' },
  { terms_confirmed: 'true' },
  { request_id: 'bad' },
  { fingerprint: 'bad' },
])('rejects invalid %j', (change) => {
  expect(eventSupplierSaveSchema.safeParse({ ...valid, ...change }).success).toBe(false)
})
it('keeps an unchecked confirmation false', () => {
  const form = new FormData()
  form.set('draft_id', id)
  form.set('supplier_code', 'SUP')
  form.set('terms_confirmed', 'on')
  expect(eventSupplierInputSchema.parse(eventSupplierFormValues(form)).terms_confirmed).toBe(false)
})
