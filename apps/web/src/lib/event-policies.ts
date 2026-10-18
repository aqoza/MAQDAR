import { z } from 'zod'
import { eventReportSchema } from './planned-events'
import { policyEvidenceSchema } from './inventory-policy'

export const eventPolicyInputSchema = z.object({
  event_id: z.uuid(),
  policy_id: z.uuid(),
  reason: z.string().trim().min(1).max(2000),
})
export const eventPolicySaveSchema = eventPolicyInputSchema.extend({
  request_id: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export const eventPolicyStatuses = [
  'available',
  'policy_unavailable',
  'source_mismatch',
  'evidence_invalid',
  'lifecycle_conflict',
] as const
const decimal = z.string().regex(/^\d+(\.\d+)?$/)
const period = z.object({
  days: z.number().int(),
  forecast: decimal,
  quantile: decimal,
  target: decimal,
  safety_stock: decimal,
})
const comparison = z.object({ baseline: period, addition: decimal, adjusted: period })
export const eventPolicyReportSchema = z.object({
  method: z.literal('event-policy-v1'),
  status: z.literal('available'),
  input: eventPolicyInputSchema,
  location_id: z.uuid(),
  event: eventReportSchema,
  policy: z.object({ id: z.uuid(), run_id: z.uuid(), evidence: policyEvidenceSchema }),
  periods: z.object({ lead_time: comparison, protection: comparison }),
  outside_addition: decimal,
  daily: z
    .array(
      z.object({
        date: z.iso.date(),
        addition: decimal,
        in_lead_time: z.boolean(),
        in_protection: z.boolean(),
      }),
    )
    .min(1)
    .max(90),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export type EventPolicyInput = z.infer<typeof eventPolicyInputSchema>
export type EventPolicyReport = z.infer<typeof eventPolicyReportSchema>
export function eventPolicyFormValues(form: FormData) {
  return Object.fromEntries(
    ['event_id', 'policy_id', 'reason', 'request_id', 'fingerprint'].map((key) => [
      key,
      form.get(key),
    ]),
  )
}
