import { z } from 'zod'
import { transferFreightReportSchema } from './transfer-freight'
import { csvReport } from './imports/report'
import { parseListParams, type ListSpec, type RawSearchParams } from './master-data/list-params'

export const handoffInputSchema = z.object({ proposal_id: z.uuid() })
export const handoffPayloadSchema = z.object({
  schema_version: z.literal('transfer-handoff-v1'),
  purpose: z.literal('planning_only'),
  notice: z.string(),
  handoff_id: z.uuid(),
  organization_id: z.uuid(),
  created_by: z.uuid(),
  created_at: z.string(),
  proposal: z.object({
    id: z.uuid(),
    revision: z.number().int().positive(),
    estimate_id: z.uuid(),
    redistribution_id: z.uuid(),
    submitted_by: z.uuid(),
    submitted_at: z.string(),
    reason: z.string(),
    approved_by: z.uuid(),
    approved_at: z.string(),
    approval_reason: z.string(),
  }),
  estimate: transferFreightReportSchema,
})
export type TransferHandoffPayload = z.infer<typeof handoffPayloadSchema>

// The v1 fixture snapshots pin field order and encoding, including nested evidence.
// Future report/contract changes must retain this version's download behavior.
export function handoffJson(payload: TransferHandoffPayload): string {
  return JSON.stringify(handoffPayloadSchema.parse(payload), null, 2) + '\n'
}

export function handoffCsvFields(payload: TransferHandoffPayload) {
  const p = handoffPayloadSchema.parse(payload)
  const freight = p.estimate
  const dates = freight.source
  const redistribution = dates.source
  const destination = redistribution.destination
  const sourcePolicy = redistribution.source_policy
  return {
    schema_version: p.schema_version,
    purpose: p.purpose,
    notice: p.notice,
    handoff_id: p.handoff_id,
    organization_id: p.organization_id,
    created_at: p.created_at,
    created_by: p.created_by,
    proposal_id: p.proposal.id,
    proposal_revision: p.proposal.revision,
    submitted_by: p.proposal.submitted_by,
    submitted_at: p.proposal.submitted_at,
    proposal_reason: p.proposal.reason,
    approved_by: p.proposal.approved_by,
    approved_at: p.proposal.approved_at,
    approval_reason: p.proposal.approval_reason,
    estimate_id: p.proposal.estimate_id,
    redistribution_id: p.proposal.redistribution_id,
    date_scenario_id: freight.scenario_id,
    destination_draft_id: redistribution.draft_id,
    source_policy_id: redistribution.source_policy_id,
    source_forecast_id: sourcePolicy?.forecast_id,
    destination_policy_id: destination.policy.policy_id,
    destination_forecast_id: destination.policy.forecast_id,
    item_id: redistribution.source_item_id,
    item_code: destination.policy.item_code,
    source_location_id: freight.source_location_id,
    source_location_code: redistribution.source_location_code,
    destination_location_id: freight.location_id,
    destination_location_code: destination.policy.location_code,
    quantity: redistribution.quantity,
    unit: destination.policy.unit,
    cutoff: destination.policy.cutoff,
    requested_dispatch_date: dates.requested_date,
    dispatch_date: dates.dispatch?.date,
    typical_lead_time_days: dates.receipts.p50?.lead_time,
    typical_receipt_date: dates.receipts.p50?.search.date,
    slow_lead_time_days: dates.receipts.p90?.lead_time,
    slow_receipt_date: dates.receipts.p90?.search.date,
    timing_reference_date: dates.timing_reference_date,
    typical_timing_review_required: dates.receipts.p50?.timing_review_required,
    slow_timing_review_required: dates.receipts.p90?.timing_review_required,
    source_maximum_basis: redistribution.basis,
    source_override_id: redistribution.override_id,
    source_maximum: sourcePolicy?.maximum,
    source_unallocated_backorders: redistribution.backorders,
    source_surplus: redistribution.source_surplus,
    destination_gap: destination.gap,
    destination_maximum_basis: destination.policy.basis,
    destination_override_id: destination.policy.override_id,
    destination_maximum: destination.policy.maximum,
    destination_unallocated_backorders: destination.backorders,
    lane_id: freight.terms?.id,
    freight_basis: freight.terms?.basis,
    freight_rate: freight.terms?.rate,
    freight_unit: freight.terms?.unit,
    freight_valid_from: freight.terms?.valid_from,
    freight_updated_at: freight.terms?.updated_at,
    shipment_count: freight.shipment_count,
    currency: freight.terms?.currency,
    currency_minor_units: freight.terms?.minor_units,
    subtotal: freight.subtotal,
    exact_product: freight.exact_product,
    rounding: freight.rounding,
    estimate_fingerprint: freight.fingerprint,
    dates_fingerprint: dates.fingerprint,
    redistribution_fingerprint: redistribution.fingerprint,
    destination_draft_fingerprint: destination.fingerprint,
  }
}

export function handoffCsv(payload: TransferHandoffPayload): string {
  const fields = handoffCsvFields(payload)
  return [...csvReport(Object.keys(fields), [Object.values(fields)])].join('')
}

export const handoffListSpec: ListSpec = {
  sorts: ['created_at'],
  defaultSort: 'created_at',
  defaultDir: 'desc',
  tiebreak: 'id',
  search: true,
  filters: [
    {
      param: 'location',
      column: 'location_code',
      kind: 'pattern',
      pattern: /^[A-Za-z0-9_.-]{1,64}$/,
    },
    { param: 'source', column: 'source_code', kind: 'pattern', pattern: /^[A-Za-z0-9_.-]{1,64}$/ },
    { param: 'selection', column: 'selected', kind: 'enum', values: ['current', 'historical'] },
  ],
}
export const handoffListParams = (raw: RawSearchParams) => parseListParams(raw, handoffListSpec)
export const handoffRowSchema = z.object({
  id: z.uuid(),
  proposal_id: z.uuid(),
  created_at: z.string(),
  selected: z.boolean(),
  item_code: z.string(),
  location_code: z.string(),
  source_code: z.string(),
  quantity: z.string(),
  unit: z.string(),
  currency: z.string(),
  subtotal: z.string(),
  minor_units: z.number().int(),
})
