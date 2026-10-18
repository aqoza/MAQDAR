import { z } from 'zod'
import { eventQuantitySchema } from './planned-events'
import { eventPolicyReportSchema } from './event-policies'
import { replenishmentReportSchema, replenishmentStatuses } from './replenishment'

export const eventDraftInputSchema = z.object({
  scenario_id: z.guid(),
  backorders: eventQuantitySchema,
  orders_confirmed: z.boolean(),
  event_uncommitted: z.boolean(),
})
export const eventDraftSaveSchema = eventDraftInputSchema.extend({
  request_id: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export const eventDraftStatuses = [
  ...replenishmentStatuses,
  'scenario_changed',
  'event_unconfirmed',
] as const
const decimal = z.string().regex(/^-?\d+(\.\d+)?$/)
export const eventDraftReportSchema = z.object({
  method: z.literal('event-replenishment-v1'),
  status: z.literal('available'),
  input: eventDraftInputSchema,
  location_id: z.guid(),
  scenario: eventPolicyReportSchema,
  baseline: replenishmentReportSchema,
  baseline_maximum: decimal,
  adjusted_maximum: decimal,
  baseline_gap: decimal,
  adjusted_gap: decimal,
  gap_increase: decimal,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export type EventDraftInput = z.infer<typeof eventDraftInputSchema>
export type EventDraftReport = z.infer<typeof eventDraftReportSchema>
export function eventDraftFormValues(form: FormData) {
  return {
    scenario_id: form.get('scenario_id'),
    backorders: form.get('backorders'),
    orders_confirmed: form.get('orders_confirmed') === 'true',
    event_uncommitted: form.get('event_uncommitted') === 'true',
    request_id: form.get('request_id'),
    fingerprint: form.get('fingerprint'),
  }
}
