import { z } from 'zod'
import { eventDraftReportSchema } from './event-replenishment'
import { supplierScenarioStatuses, supplierScenarioReportSchema } from './supplier-scenarios'

export const eventSupplierStatuses = supplierScenarioStatuses
export const eventSupplierInputSchema = z.object({
  draft_id: z.guid(),
  supplier_code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
  terms_confirmed: z.boolean(),
})
export const eventSupplierSaveSchema = eventSupplierInputSchema.extend({
  request_id: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
const decimal = z.string().regex(/^\d+(\.\d+)?$/)
const comparison = z.object({ gap: decimal, quantity: decimal, overage: decimal })
export const eventSupplierReportSchema = z.object({
  method: z.literal('event-supplier-v1'),
  status: z.literal('available'),
  location_id: z.guid(),
  input: eventSupplierInputSchema,
  draft: eventDraftReportSchema,
  supplier: supplierScenarioReportSchema.shape.supplier.unwrap(),
  terms: supplierScenarioReportSchema.shape.terms.unwrap(),
  baseline: comparison,
  adjusted: comparison,
  quantity_increase: decimal,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export type EventSupplierInput = z.infer<typeof eventSupplierInputSchema>
export type EventSupplierReport = z.infer<typeof eventSupplierReportSchema>
export function eventSupplierFormValues(form: FormData) {
  return {
    draft_id: form.get('draft_id'),
    supplier_code: form.get('supplier_code'),
    terms_confirmed: form.get('terms_confirmed') === 'true',
    request_id: form.get('request_id'),
    fingerprint: form.get('fingerprint'),
  }
}
