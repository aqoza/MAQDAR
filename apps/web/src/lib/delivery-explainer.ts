import { z } from 'zod'
import { explanationRequestSchema } from './policy-explainer'
export const deliveryEvidenceReferences = [
  'delivery_context',
  'schedule',
  'calendar_adjustments',
  'delivery_limits',
] as const
const decimal = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .max(100)
const searchSummary = z
  .strictObject({
    evaluated_days: z.number().int().min(1).max(90),
    closed_days: z.number().int().min(0).max(89),
    closed_reasons: z.strictObject({
      calendar_override: z.number().int().min(0).max(89),
      country_override: z.number().int().min(0).max(89),
      public_holiday: z.number().int().min(0).max(89),
      weekend: z.number().int().min(0).max(89),
    }),
    selected_reason: z.enum(['calendar_override', 'country_override', 'weekly_pattern']),
  })
  .refine(
    (s) =>
      s.evaluated_days === s.closed_days + 1 &&
      Object.values(s.closed_reasons).reduce((a, b) => a + b, 0) === s.closed_days,
    'Inconsistent saved search counts',
  )
const common = {
  method: z.literal('delivery-explainer-v1'),
  unit: z.enum(['EA', 'SET', 'L', 'KG']),
  delivery_context: z.strictObject({
    cutoff: z.iso.date(),
    quantity: decimal,
    lead_time_days: z.number().int().min(0).max(3650),
    requested_date: z.iso.date(),
  }),
  delivery_limits: z.strictObject({ interpretation: z.string().min(1).max(1000) }),
}
export const deliveryExplanationEvidenceSchema = z
  .discriminatedUnion('outcome', [
    z.strictObject({
      ...common,
      outcome: z.literal('available'),
      schedule: z.strictObject({
        order_date: z.iso.date(),
        nominal_receipt: z.iso.date(),
        receipt_date: z.iso.date(),
        policy_reference_date: z.iso.date(),
        elapsed_days: z.number().int().nonnegative(),
        policy_recalculation_required: z.boolean(),
      }),
      calendar_adjustments: z.strictObject({
        calendars_confirmed: z.literal(true),
        supplier: searchSummary,
        receiver: searchSummary,
      }),
    }),
    z.strictObject({
      ...common,
      outcome: z.literal('no_order_needed'),
      schedule: z.null(),
      calendar_adjustments: z.null(),
    }),
  ])
  .superRefine((e, ctx) => {
    const invalid = () =>
      ctx.addIssue({ code: 'custom', message: 'Inconsistent captured delivery evidence' })
    const day = (s: string) => Date.parse(s) / 86400000
    const c = e.delivery_context
    if (c.requested_date < c.cutoff) invalid()
    if (e.outcome === 'no_order_needed') {
      if (!/^0+(?:\.0+)?$/.test(c.quantity)) invalid()
      return
    }
    if (/^0+(?:\.0+)?$/.test(c.quantity)) invalid()
    const s = e.schedule,
      a = e.calendar_adjustments
    if (
      s.order_date < c.requested_date ||
      day(s.nominal_receipt) !== day(s.order_date) + c.lead_time_days ||
      s.receipt_date < s.nominal_receipt ||
      day(s.policy_reference_date) !== day(c.cutoff) + c.lead_time_days ||
      s.elapsed_days !== day(s.receipt_date) - day(c.cutoff) ||
      s.policy_recalculation_required !== s.receipt_date > s.policy_reference_date ||
      a.supplier.closed_days !== day(s.order_date) - day(c.requested_date) ||
      a.receiver.closed_days !== day(s.receipt_date) - day(s.nominal_receipt)
    )
      invalid()
  })
export const deliveryExplanationPreviewSchema = z.strictObject({
  evidence: deliveryExplanationEvidenceSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  scenario_id: z.guid(),
  location_id: z.guid(),
})
export const deliveryExplanationRequestSchema = explanationRequestSchema
  .omit({ policy_id: true })
  .extend({ scenario_id: z.guid() })
export const deliveryExplanationAnswerSchema = z.strictObject({
  paragraphs: z
    .array(
      z.strictObject({
        text: z.string().trim().min(1).max(2000),
        references: z.array(z.enum(deliveryEvidenceReferences)).min(1).max(4),
      }),
    )
    .min(1)
    .max(8),
})
export type DeliveryExplanationEvidence = z.infer<typeof deliveryExplanationEvidenceSchema>
export type DeliveryExplanationAnswer = z.infer<typeof deliveryExplanationAnswerSchema>
