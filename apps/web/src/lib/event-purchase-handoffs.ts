import { z } from 'zod'
import { eventCostReportSchema, type EventCostReport } from './event-costs'
import { csvReport } from './imports/report'
import {
  handoffPayloadSchema as purchasePayload,
  handoffRowSchema as purchaseRow,
  handoffInputSchema,
  handoffListParams,
  handoffListSpec,
} from './purchase-handoffs'
export { handoffInputSchema, handoffListParams, handoffListSpec }

export const handoffPayloadSchema = purchasePayload.extend({
  schema_version: z.literal('event-purchase-handoff-v1'),
  selected_quantity_basis: z.literal('full_event_adjusted'),
  evidence: purchasePayload.shape.evidence.extend({
    event_id: z.guid(),
    event_policy_id: z.guid(),
    delivery_id: z.guid(),
    supplier_scenario_id: z.guid(),
  }),
  // Display schemas intentionally select subsets of nested forecast evidence.
  // Validate their required shape without stripping any original saved fields.
  estimate: z.custom<EventCostReport>((value) => eventCostReportSchema.safeParse(value).success),
})
export type HandoffPayload = z.infer<typeof handoffPayloadSchema>
export const handoffRowSchema = purchaseRow.extend({ event_name: z.string() })

// Freeze this version's field order and exact decimal strings for historical downloads.
export function handoffJson(payload: HandoffPayload): string {
  return JSON.stringify(orderedJson(handoffPayloadSchema.parse(payload)), null, 2) + '\n'
}

function orderedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(orderedJson)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => [key, orderedJson(child)]),
    )
  }
  return value
}

export function handoffCsv(payload: HandoffPayload): string {
  const p = handoffPayloadSchema.parse(payload)
  const cost = p.estimate
  const delivery = cost.source
  const supplier = delivery.source
  const draft = supplier.draft
  const event = draft.scenario.event
  const fields = {
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
    draft_id: p.proposal.draft_id,
    event_id: p.evidence.event_id,
    event_policy_id: p.evidence.event_policy_id,
    policy_id: p.evidence.policy_id,
    forecast_id: p.evidence.forecast_id,
    event_name: event.input.name,
    event_type: event.input.event_type,
    event_reason: event.input.reason,
    item_id: event.source.item_id,
    item_code: event.source.item_code,
    location_id: cost.location_id,
    location_code: event.source.location_code,
    supplier_id: supplier.supplier.id,
    supplier_code: supplier.supplier.code,
    selected_quantity_basis: 'full_event_adjusted',
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
    selected_adjusted_subtotal: cost.adjusted.subtotal,
    baseline_comparison_subtotal: cost.baseline.subtotal,
    comparison_cost_increase: cost.cost_increase,
    adjusted_exact_product: cost.adjusted.exact_product,
    baseline_exact_product: cost.baseline.exact_product,
    rounding: cost.rounding,
    price_terms_id: cost.price?.terms_id,
    price_valid_from: cost.price?.valid_from,
    price_updated_at: cost.price?.updated_at,
    delivery_id: p.evidence.delivery_id,
    supplier_scenario_id: p.evidence.supplier_scenario_id,
    draft_fingerprint: p.evidence.draft_fingerprint,
    estimate_fingerprint: cost.fingerprint,
    delivery_fingerprint: delivery.fingerprint,
    supplier_fingerprint: supplier.fingerprint,
    event_policy_fingerprint: draft.scenario.fingerprint,
    event_fingerprint: event.fingerprint,
  }
  return [...csvReport(Object.keys(fields), [Object.values(fields)])].join('')
}
