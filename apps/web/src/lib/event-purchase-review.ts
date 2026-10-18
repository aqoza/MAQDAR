import { z } from 'zod'
import { eventCostReportSchema } from './event-costs'
import { eventDeliveryReportSchema } from './event-deliveries'
import {
  workbenchRowSchema as purchaseRow,
  workbenchParams,
  workbenchSpec,
  REVIEW_STATUSES,
  proposalSchema,
  decisionSchema,
} from './purchase-review'
export { workbenchParams, workbenchSpec, REVIEW_STATUSES, proposalSchema, decisionSchema }
export const workbenchRowSchema = purchaseRow.extend({
  event_name: z.string(),
  baseline_quantity: z.string(),
  baseline_subtotal: z.string(),
  cost_increase: z.string(),
})
export function eventApprovalTimingClear(source: {
  policy_recalculation_required?: boolean | null
  event_before_receipt?: unknown
}) {
  return (
    source.policy_recalculation_required === false &&
    Array.isArray(source.event_before_receipt) &&
    source.event_before_receipt.length === 0
  )
}

// Older or incomplete timing evidence stays inspectable and fails the approval gate.
export const eventReviewCostSchema = eventCostReportSchema.extend({
  source: eventDeliveryReportSchema.extend({
    policy_recalculation_required: z
      .boolean()
      .nullish()
      .transform((value) => value ?? null),
    event_before_receipt: eventDeliveryReportSchema.shape.event_before_receipt
      .optional()
      .transform((value) => value ?? null),
  }),
})
