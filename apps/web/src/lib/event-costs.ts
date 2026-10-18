import { z } from 'zod'
import { eventDeliveryReportSchema } from './event-deliveries'
import { calendarEntitySchema } from './delivery-scenarios'
import { purchaseCostReportSchema, purchaseCostStatuses } from './purchase-costs'

export const eventCostStatuses = [...purchaseCostStatuses, 'location_unavailable'] as const
export const eventCostInputSchema = z.object({
  delivery_id: z.guid(),
  price_confirmed: z.boolean(),
})
export const eventCostSaveSchema = eventCostInputSchema.extend({
  request_id: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
const decimal = z.string().regex(/^\d+(\.\d+)?$/)
const comparison = z.object({
  quantity: decimal,
  exact_product: decimal.nullable(),
  subtotal: decimal.nullable(),
})
export const eventCostReportSchema = z.object({
  method: z.literal('event-purchase-cost-v1'),
  status: z.enum(eventCostStatuses),
  location_id: z.guid(),
  input: eventCostInputSchema,
  source: eventDeliveryReportSchema,
  supplier: calendarEntitySchema.nullable(),
  receiver: calendarEntitySchema.nullable(),
  price: purchaseCostReportSchema.shape.price,
  baseline: comparison,
  adjusted: comparison,
  cost_increase: decimal.nullable(),
  rounding: z.literal('half-up-currency-minor-units'),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export type EventCostInput = z.infer<typeof eventCostInputSchema>
export type EventCostReport = z.infer<typeof eventCostReportSchema>
export const isSaveableEventCost = (status: EventCostReport['status']) =>
  status === 'available' || status === 'no_order_needed'
export function eventCostFormValues(form: FormData) {
  return {
    delivery_id: form.get('delivery_id'),
    price_confirmed: form.get('price_confirmed') === 'true',
    request_id: form.get('request_id'),
    fingerprint: form.get('fingerprint'),
  }
}
