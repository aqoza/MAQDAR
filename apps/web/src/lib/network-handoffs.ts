import { z } from 'zod'
import { networkFreightReportSchema } from './network-freight'
import {
  handoffInputSchema,
  handoffPayloadSchema as transferPayloadSchema,
} from './transfer-handoffs'
import { csvReport } from './imports/report'
import { parseListParams, type ListSpec, type RawSearchParams } from './master-data/list-params'

export { handoffInputSchema }
export const handoffPayloadSchema = transferPayloadSchema.extend({
  schema_version: z.literal('network-transfer-handoff-v1'),
  proposal: transferPayloadSchema.shape.proposal.omit({ redistribution_id: true }).extend({
    allocation_id: z.guid(),
  }),
  estimate: networkFreightReportSchema,
})
export type NetworkHandoffPayload = z.infer<typeof handoffPayloadSchema>

// Pinned by the v1 fixture snapshots. Later schemas must preserve v1 downloads.
export function handoffJson(payload: NetworkHandoffPayload): string {
  return JSON.stringify(handoffPayloadSchema.parse(payload), null, 2) + '\n'
}

export function handoffCsvRows(payload: NetworkHandoffPayload) {
  const p = handoffPayloadSchema.parse(payload)
  const freight = p.estimate
  const dates = freight.source
  const allocation = dates.source
  return freight.lines.map((line) => {
    const date = dates.lines.find((d) => d.location_id === line.location_id)
    const branch = allocation.lines.find((b) => b.location_id === line.location_id)
    if (!date || !branch) throw new Error('Incomplete network handoff lineage')
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
      allocation_id: p.proposal.allocation_id,
      date_scenario_id: freight.scenario_id,
      destination_draft_id: branch.draft_id,
      source_policy_id: allocation.source_policy_id,
      destination_policy_id: date.policy_reference?.id,
      item_id: allocation.item_id,
      item_code: allocation.source_policy?.item_code,
      source_location_id: freight.source_location_id,
      source_location_code: allocation.source_location_code,
      destination_location_id: line.location_id,
      destination_location_code: line.location_code,
      transfer_status: line.status,
      quantity: line.quantity,
      unit: allocation.source_policy?.unit,
      cutoff: allocation.source_policy?.cutoff,
      requested_dispatch_date: dates.requested_date,
      // The package dispatch is context; zero branches have no transfer dates.
      package_dispatch_date: dates.dispatch?.date,
      dispatch_date: line.status === 'no_transfer_needed' ? null : dates.dispatch?.date,
      typical_lead_time_days: date.receipts.p50?.lead_time,
      typical_receipt_date: date.receipts.p50?.search.date,
      slow_lead_time_days: date.receipts.p90?.lead_time,
      slow_receipt_date: date.receipts.p90?.search.date,
      timing_reference_date: date.timing_reference_date,
      typical_timing_review_required: date.receipts.p50?.timing_review_required,
      slow_timing_review_required: date.receipts.p90?.timing_review_required,
      source_maximum_basis: allocation.basis,
      source_override_id: allocation.override_id,
      source_maximum: allocation.source_policy?.maximum,
      source_unallocated_backorders: allocation.backorders,
      source_surplus: allocation.source_surplus,
      source_remaining_surplus: allocation.remaining_surplus,
      source_retained_available: allocation.retained_available,
      destination_gap: branch.gap,
      destination_remaining_gap: branch.remaining_gap,
      lane_id: date.lane?.id,
      freight_basis: line.terms?.basis,
      freight_rate: line.terms?.rate,
      freight_unit: line.terms?.unit,
      freight_valid_from: line.terms?.valid_from,
      freight_updated_at: line.terms?.updated_at,
      shipment_count: line.shipment_count,
      currency: line.terms?.currency,
      currency_minor_units: line.terms?.minor_units,
      subtotal: line.subtotal,
      exact_product: line.exact_product,
      rounding: freight.rounding,
      // Repeated package-level metadata, never a per-branch cost.
      package_totals_json: JSON.stringify(freight.totals),
      estimate_fingerprint: freight.fingerprint,
      dates_fingerprint: dates.fingerprint,
      allocation_fingerprint: allocation.fingerprint,
      destination_draft_fingerprint: branch.evidence.destination.fingerprint,
    }
  })
}

export function handoffCsv(payload: NetworkHandoffPayload): string {
  const rows = handoffCsvRows(payload)
  return [
    ...csvReport(
      Object.keys(rows[0]),
      rows.map((row) => Object.values(row)),
    ),
  ].join('')
}

export const handoffListSpec: ListSpec = {
  sorts: ['created_at'],
  defaultSort: 'created_at',
  defaultDir: 'desc',
  tiebreak: 'id',
  search: true,
  filters: [
    { param: 'source', column: 'source_code', kind: 'pattern', pattern: /^[A-Za-z0-9_.-]{1,64}$/ },
    { param: 'selection', column: 'selected', kind: 'enum', values: ['current', 'historical'] },
  ],
}
export const handoffListParams = (raw: RawSearchParams) => parseListParams(raw, handoffListSpec)
export const handoffRowSchema = z.object({
  id: z.guid(),
  proposal_id: z.guid(),
  created_at: z.string(),
  selected: z.boolean(),
  item_code: z.string(),
  source_code: z.string(),
  dispatch_date: z.iso.date(),
  branch_count: z.number().int(),
  quantity: z.string(),
  unit: z.string(),
  totals: networkFreightReportSchema.shape.totals,
})
