import { z } from 'zod'
import { eventSupplierReportSchema } from './event-suppliers'
import {
  calendarEntitySchema,
  calendarEvidenceSchema,
  calendarSearchSchema,
  deliveryScenarioStatuses,
} from './delivery-scenarios'

export const eventDeliveryInputSchema = z.object({
  scenario_id: z.guid(),
  requested_date: z.iso.date().refine((value) => value >= '1900-01-01' && value <= '2100-12-31'),
  calendars_confirmed: z.boolean(),
})
export const eventDeliverySaveSchema = eventDeliveryInputSchema.extend({
  request_id: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export const eventDeliveryReportSchema = z.object({
  method: z.literal('event-delivery-v1'),
  status: z.enum(deliveryScenarioStatuses),
  location_id: z.guid(),
  input: eventDeliveryInputSchema,
  source: eventSupplierReportSchema,
  supplier: calendarEntitySchema.nullable(),
  receiver: calendarEntitySchema.nullable(),
  supplier_calendar: calendarEvidenceSchema.nullable(),
  receiver_calendar: calendarEvidenceSchema.nullable(),
  order_search: calendarSearchSchema.nullable(),
  receipt_search: calendarSearchSchema.nullable(),
  blocked_stage: z.enum(['supplier', 'receiver']).nullable(),
  order_date: z.iso.date().nullable(),
  nominal_receipt: z.iso.date().nullable(),
  receipt_date: z.iso.date().nullable(),
  expected_receipt: z.iso.date().nullable(),
  policy_recalculation_required: z.boolean().nullable(),
  event_before_receipt: z
    .array(z.object({ date: z.iso.date(), quantity: z.string().regex(/^\d+(\.\d+)?$/) }))
    .max(90)
    .nullable(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export type EventDeliveryInput = z.infer<typeof eventDeliveryInputSchema>
export type EventDeliveryReport = z.infer<typeof eventDeliveryReportSchema>
export const isZeroQuantity = (quantity: string) => /^0(?:\.0+)?$/.test(quantity)
export const isSaveableDelivery = (status: EventDeliveryReport['status']) =>
  status === 'available' || status === 'no_order_needed'
export function eventDeliveryFormValues(form: FormData) {
  return {
    scenario_id: form.get('scenario_id'),
    requested_date: form.get('requested_date'),
    calendars_confirmed: form.get('calendars_confirmed') === 'true',
    request_id: form.get('request_id'),
    fingerprint: form.get('fingerprint'),
  }
}
