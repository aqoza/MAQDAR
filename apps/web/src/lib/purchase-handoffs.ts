import { z } from 'zod'
import { purchaseCostReportSchema } from './purchase-costs'
import { csvReport } from './imports/report'
import { parseListParams, type ListSpec, type RawSearchParams } from './master-data/list-params'

export const handoffInputSchema = z.object({ proposal_id: z.guid() })
export const handoffPayloadSchema = z.object({
  schema_version: z.literal('purchase-handoff-v1'),
  purpose: z.literal('planning_only'),
  notice: z.string(),
  handoff_id: z.guid(),
  organization_id: z.guid(),
  created_by: z.guid(),
  created_at: z.string(),
  proposal: z.object({
    id: z.guid(),
    revision: z.number().int().positive(),
    estimate_id: z.guid(),
    draft_id: z.guid(),
    submitted_by: z.guid(),
    submitted_at: z.string(),
    reason: z.string(),
    approved_by: z.guid(),
    approved_at: z.string(),
    approval_reason: z.string(),
  }),
  evidence: z.object({ policy_id: z.guid(), forecast_id: z.guid(), draft_fingerprint: z.string() }),
  estimate: purchaseCostReportSchema,
})
export type HandoffPayload = z.infer<typeof handoffPayloadSchema>

// Freeze v1 field order and serialization. A changed contract gets a new version.
export function handoffJson(payload: HandoffPayload): string {
  return JSON.stringify(handoffPayloadSchema.parse(payload), null, 2) + '\n'
}

export function handoffCsv(payload: HandoffPayload): string {
  const p = handoffPayloadSchema.parse(payload)
  const { source, price } = p.estimate
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
    policy_id: p.evidence.policy_id,
    forecast_id: p.evidence.forecast_id,
    item_id: source.item_id,
    item_code: source.item_code,
    location_id: p.estimate.location_id,
    location_code: source.location_code,
    supplier_id: source.supplier_id,
    supplier_code: source.supplier_code,
    quantity: source.quantity,
    unit: source.unit,
    cutoff: source.cutoff,
    order_date: source.order_date,
    receipt_date: source.receipt_date,
    unit_price: price?.unit_price,
    currency: price?.currency,
    currency_minor_units: price?.minor_units,
    subtotal: p.estimate.subtotal,
    exact_product: p.estimate.exact_product,
    rounding: p.estimate.rounding,
    price_terms_id: price?.terms_id,
    price_valid_from: price?.valid_from,
    price_updated_at: price?.updated_at,
    delivery_id: source.delivery_id,
    supplier_scenario_id: source.supplier_scenario_id,
    draft_fingerprint: p.evidence.draft_fingerprint,
    estimate_fingerprint: p.estimate.fingerprint,
    delivery_fingerprint: source.delivery_fingerprint,
    supplier_fingerprint: source.supplier_fingerprint,
  }
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
    {
      param: 'supplier',
      column: 'supplier_code',
      kind: 'pattern',
      pattern: /^[A-Za-z0-9_.-]{1,64}$/,
    },
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
  location_code: z.string(),
  supplier_code: z.string(),
  quantity: z.string(),
  unit: z.string(),
  currency: z.string(),
  subtotal: z.string(),
  minor_units: z.number().int(),
})
