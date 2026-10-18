import { z } from 'zod'
import { handoffPayloadSchema, handoffListSpec } from './purchase-handoffs'
import { csvReport } from './imports/report'
import { parseListParams, type RawSearchParams } from './master-data/list-params'

export const batchInputSchema = z
  .array(z.guid())
  .min(1)
  .max(50)
  .refine((ids) => new Set(ids).size === ids.length)
export const batchSummarySchema = z.object({
  supplier_id: z.guid(),
  supplier_code: z.string(),
  location_id: z.guid(),
  location_code: z.string(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  minor_units: z.number().int().min(0).max(3),
  order_date: z.iso.date(),
  line_count: z.number().int().min(1).max(50),
  subtotal: z.string().regex(/^\d+(\.\d+)?$/),
})
export const batchPreviewSchema = z.object({
  existing_batch_id: z.guid().nullable(),
  summary: batchSummarySchema,
  lines: z.array(handoffPayloadSchema).min(1).max(50),
})
export const batchPayloadSchema = z.object({
  schema_version: z.literal('purchase-handoff-batch-v1'),
  purpose: z.literal('planning_only'),
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

// Keep these v1 serializers stable, including line order and decimal strings.
export function batchJson(payload: BatchPayload): string {
  return JSON.stringify(batchPayloadSchema.parse(payload), null, 2) + '\n'
}
export function batchCsv(payload: BatchPayload): string {
  const p = batchPayloadSchema.parse(payload)
  const rows = p.lines.map((line, index) => ({
    schema_version: p.schema_version,
    purpose: p.purpose,
    notice: p.notice,
    batch_id: p.batch_id,
    organization_id: p.organization_id,
    created_at: p.created_at,
    created_by: p.created_by,
    batch_subtotal: p.summary.subtotal,
    batch_line_count: p.summary.line_count,
    line_number: index + 1,
    handoff_id: line.handoff_id,
    proposal_id: line.proposal.id,
    proposal_revision: line.proposal.revision,
    estimate_id: line.proposal.estimate_id,
    draft_id: line.proposal.draft_id,
    policy_id: line.evidence.policy_id,
    forecast_id: line.evidence.forecast_id,
    item_id: line.estimate.source.item_id,
    item_code: line.estimate.source.item_code,
    supplier_id: p.summary.supplier_id,
    supplier_code: line.estimate.source.supplier_code,
    location_id: p.summary.location_id,
    location_code: line.estimate.source.location_code,
    quantity: line.estimate.source.quantity,
    unit: line.estimate.source.unit,
    cutoff: line.estimate.source.cutoff,
    order_date: line.estimate.source.order_date,
    receipt_date: line.estimate.source.receipt_date,
    unit_price: line.estimate.price?.unit_price,
    currency: line.estimate.price?.currency,
    currency_minor_units: line.estimate.price?.minor_units,
    line_subtotal: line.estimate.subtotal,
    exact_product: line.estimate.exact_product,
    rounding: line.estimate.rounding,
    price_terms_id: line.estimate.price?.terms_id,
    price_valid_from: line.estimate.price?.valid_from,
    price_updated_at: line.estimate.price?.updated_at,
    submitted_by: line.proposal.submitted_by,
    submitted_at: line.proposal.submitted_at,
    proposal_reason: line.proposal.reason,
    approved_by: line.proposal.approved_by,
    approved_at: line.proposal.approved_at,
    approval_reason: line.proposal.approval_reason,
    delivery_id: line.estimate.source.delivery_id,
    supplier_scenario_id: line.estimate.source.supplier_scenario_id,
    draft_fingerprint: line.evidence.draft_fingerprint,
    estimate_fingerprint: line.estimate.fingerprint,
    delivery_fingerprint: line.estimate.source.delivery_fingerprint,
    supplier_fingerprint: line.estimate.source.supplier_fingerprint,
  }))
  return [...csvReport(Object.keys(rows[0]), rows.map(Object.values))].join('')
}
export const batchListSpec = handoffListSpec
export const batchListParams = (raw: RawSearchParams) => parseListParams(raw, batchListSpec)
export const batchRowSchema = z.object({
  id: z.guid(),
  created_at: z.string(),
  supplier_code: z.string(),
  location_code: z.string(),
  currency: z.string(),
  minor_units: z.number().int(),
  subtotal: z.string(),
  order_date: z.iso.date(),
  line_count: z.number().int(),
  selected: z.boolean(),
  overlap_count: z.number().int(),
})
export const batchErrorKeys = {
  batch_selection_invalid: 'invalidSelection',
  batch_source_invalid: 'sourceInvalid',
  batch_group_mismatch: 'groupMismatch',
  batch_duplicate_item: 'duplicateItem',
  handoff_selection_changed: 'selectionChanged',
  purchase_price_changed: 'priceChanged',
  purchase_policy_required: 'policyRequired',
} as const
export function batchErrorKey(hint: string | undefined | null) {
  return hint && Object.hasOwn(batchErrorKeys, hint)
    ? batchErrorKeys[hint as keyof typeof batchErrorKeys]
    : 'unavailable'
}
export function batchSelection(raw: RawSearchParams): string[] {
  const values = raw.handoff ? (Array.isArray(raw.handoff) ? raw.handoff : [raw.handoff]) : []
  // Do not silently truncate or drop invalid choices.
  return values
}
export function batchSelectionHref(ids: string[], path = '/replenishment/batches/new') {
  const params = new URLSearchParams()
  ids.forEach((id) => params.append('handoff', id))
  return ids.length ? `${path}?${params}` : path
}
