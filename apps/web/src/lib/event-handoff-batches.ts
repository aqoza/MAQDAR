import { z } from 'zod'
import { handoffPayloadSchema, handoffJson } from './event-purchase-handoffs'
import { csvReport } from './imports/report'
import {
  batchSummarySchema as purchaseSummary,
  batchRowSchema as purchaseRow,
  batchSelectionHref as purchaseSelectionHref,
} from './handoff-batches'
export { batchInputSchema, batchListSpec, batchListParams, batchSelection } from './handoff-batches'

const decimal = z.string().regex(/^\d+(\.\d+)?$/)
export const batchSummarySchema = purchaseSummary.extend({
  baseline_subtotal: decimal,
  cost_increase: decimal,
})
export const batchPreviewSchema = z.object({
  existing_batch_id: z.guid().nullable(),
  summary: batchSummarySchema,
  lines: z.array(handoffPayloadSchema).min(1).max(50),
})
export const batchPayloadSchema = z.object({
  schema_version: z.literal('event-purchase-handoff-batch-v1'),
  purpose: z.literal('planning_only'),
  selected_quantity_basis: z.literal('full_event_adjusted'),
  notice: z.string(),
  batch_id: z.guid(),
  organization_id: z.guid(),
  created_by: z.guid(),
  created_at: z.string(),
  summary: batchSummarySchema,
  lines: z.array(handoffPayloadSchema).min(1).max(50),
})
export type BatchPayload = z.infer<typeof batchPayloadSchema>
export type BatchPreview = z.infer<typeof batchPreviewSchema>
export const batchRowSchema = purchaseRow.extend({
  baseline_subtotal: decimal,
  cost_increase: decimal,
})

// Freeze v1 order and encoding, including each complete original event handoff.
export function batchJson(payload: BatchPayload): string {
  const p = batchPayloadSchema.parse(payload)
  return (
    JSON.stringify({ ...p, lines: p.lines.map((line) => JSON.parse(handoffJson(line))) }, null, 2) +
    '\n'
  )
}
export function batchCsv(payload: BatchPayload): string {
  const p = batchPayloadSchema.parse(payload)
  const rows = p.lines.map((line, index) => {
    const cost = line.estimate
    const delivery = cost.source
    const supplier = delivery.source
    const event = supplier.draft.scenario.event
    return {
      schema_version: p.schema_version,
      purpose: p.purpose,
      selected_quantity_basis: p.selected_quantity_basis,
      notice: p.notice,
      batch_id: p.batch_id,
      organization_id: p.organization_id,
      created_at: p.created_at,
      created_by: p.created_by,
      batch_adjusted_subtotal: p.summary.subtotal,
      batch_baseline_comparison_subtotal: p.summary.baseline_subtotal,
      batch_comparison_cost_increase: p.summary.cost_increase,
      batch_line_count: p.summary.line_count,
      line_number: index + 1,
      handoff_id: line.handoff_id,
      proposal_id: line.proposal.id,
      proposal_revision: line.proposal.revision,
      estimate_id: line.proposal.estimate_id,
      draft_id: line.proposal.draft_id,
      event_id: line.evidence.event_id,
      event_policy_id: line.evidence.event_policy_id,
      policy_id: line.evidence.policy_id,
      forecast_id: line.evidence.forecast_id,
      event_name: event.input.name,
      event_type: event.input.event_type,
      event_reason: event.input.reason,
      item_id: event.source.item_id,
      item_code: event.source.item_code,
      supplier_id: p.summary.supplier_id,
      supplier_code: supplier.supplier.code,
      location_id: p.summary.location_id,
      location_code: event.source.location_code,
      selected_adjusted_quantity: cost.adjusted.quantity,
      baseline_comparison_quantity: cost.baseline.quantity,
      comparison_quantity_increase: supplier.quantity_increase,
      unit: event.input.unit,
      cutoff: event.source.cutoff,
      order_date: delivery.order_date,
      receipt_date: delivery.receipt_date,
      unit_price: cost.price?.unit_price,
      currency: cost.price?.currency,
      currency_minor_units: cost.price?.minor_units,
      line_adjusted_subtotal: cost.adjusted.subtotal,
      line_baseline_comparison_subtotal: cost.baseline.subtotal,
      line_comparison_cost_increase: cost.cost_increase,
      adjusted_exact_product: cost.adjusted.exact_product,
      baseline_exact_product: cost.baseline.exact_product,
      rounding: cost.rounding,
      price_terms_id: cost.price?.terms_id,
      price_valid_from: cost.price?.valid_from,
      price_updated_at: cost.price?.updated_at,
      submitted_by: line.proposal.submitted_by,
      submitted_at: line.proposal.submitted_at,
      proposal_reason: line.proposal.reason,
      approved_by: line.proposal.approved_by,
      approved_at: line.proposal.approved_at,
      approval_reason: line.proposal.approval_reason,
      delivery_id: line.evidence.delivery_id,
      supplier_scenario_id: line.evidence.supplier_scenario_id,
      draft_fingerprint: line.evidence.draft_fingerprint,
      estimate_fingerprint: cost.fingerprint,
      delivery_fingerprint: delivery.fingerprint,
      supplier_fingerprint: supplier.fingerprint,
      event_policy_fingerprint: supplier.draft.scenario.fingerprint,
      event_fingerprint: event.fingerprint,
    }
  })
  return [...csvReport(Object.keys(rows[0]), rows.map(Object.values))].join('')
}

const batchErrorKeys = {
  batch_selection_invalid: 'invalidSelection',
  batch_source_invalid: 'sourceInvalid',
  batch_group_mismatch: 'groupMismatch',
  batch_duplicate_item: 'duplicateItem',
  handoff_selection_changed: 'selectionChanged',
  event_purchase_price_changed: 'priceChanged',
  event_purchase_policy_required: 'policyRequired',
  event_purchase_timing_required: 'timingRequired',
} as const
export function batchErrorKey(hint: string | undefined | null) {
  return hint && Object.hasOwn(batchErrorKeys, hint)
    ? batchErrorKeys[hint as keyof typeof batchErrorKeys]
    : 'unavailable'
}
export function batchSelectionHref(ids: string[], path = '/replenishment/events/batches/new') {
  return purchaseSelectionHref(ids, path)
}
