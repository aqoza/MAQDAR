import { z } from 'zod'
import { DISPOSITION_KINDS, dispositionListSpec } from './excess-disposition'
import { excessReportSchema } from './excess-stock'
import { csvReport } from './imports/report'
import { parseListParams, type ListSpec, type RawSearchParams } from './master-data/list-params'

const decimal = z.string().regex(/^\d+(\.\d+)?$/)
const lineSchema = excessReportSchema.shape.lines.element
export const handoffInputSchema = z.object({ proposal_id: z.guid() })
export const handoffPayloadSchema = z.object({
  schema_version: z.literal('excess-disposition-handoff-v1'),
  purpose: z.literal('planning_only'),
  notice: z.string(),
  handoff_id: z.guid(),
  organization_id: z.guid(),
  created_by: z.guid(),
  created_at: z.string(),
  proposal: z.object({
    id: z.guid(),
    revision: z.number().int().positive(),
    submitted_by: z.guid(),
    submitted_at: z.string(),
    reason: z.string(),
    approved_by: z.guid(),
    approved_at: z.string(),
    approval_reason: z.string(),
  }),
  assessment: z.object({
    id: z.guid(),
    submitted_by: z.guid(),
    created_at: z.string(),
    reason: z.string(),
    as_of_confirmed: z.literal(true),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  disposition: z.object({
    kind: z.enum(DISPOSITION_KINDS),
    item_id: z.guid(),
    item_code: z.string(),
    location_id: z.guid(),
    location_code: z.string(),
    cutoff: z.iso.date(),
    quantity: decimal.refine((value) => /[1-9]/.test(value)),
    unit: z.string().min(1),
    reference_value: decimal,
    currency: z.string().length(3),
  }),
  // The display schema selects nested fields; validate without stripping original evidence.
  line: z.custom<z.infer<typeof lineSchema>>((value) => lineSchema.safeParse(value).success),
})
export type DispositionHandoff = z.infer<typeof handoffPayloadSchema>

function orderedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(orderedJson)
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => [key, orderedJson(child)]),
    )
  return value
}
// Versioned deterministic files: live selection never enters the saved download.
export function handoffJson(payload: DispositionHandoff): string {
  return JSON.stringify(orderedJson(handoffPayloadSchema.parse(payload)), null, 2) + '\n'
}
export function handoffCsv(payload: DispositionHandoff): string {
  const p = handoffPayloadSchema.parse(payload)
  const d = p.disposition
  const c = p.line.comparison
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
    assessment_id: p.assessment.id,
    assessment_reason: p.assessment.reason,
    assessment_created_at: p.assessment.created_at,
    assessment_submitted_by: p.assessment.submitted_by,
    assessment_as_of_confirmed: String(p.assessment.as_of_confirmed),
    assessment_fingerprint: p.assessment.fingerprint,
    disposition_kind: d.kind,
    item_id: d.item_id,
    item_code: d.item_code,
    location_id: d.location_id,
    location_code: d.location_code,
    cutoff: d.cutoff,
    quantity: d.quantity,
    unit: d.unit,
    reference_inventory_value: d.reference_value,
    currency: d.currency,
    snapshot_unit_cost: c.snapshot?.unit_cost,
    snapshot_id: c.snapshot?.id,
    snapshot_date: c.snapshot?.date,
    snapshot_updated_at: c.snapshot?.updated_at,
    snapshot_quantity: c.snapshot?.quantity,
    snapshot_allocated: c.snapshot?.allocated,
    snapshot_available: c.snapshot?.available,
    saved_quantity_above_maximum: c.quantity_above,
    selected_maximum: c.maximum,
    maximum_basis: c.basis,
    policy_id: c.policy_id,
    policy_run_id: c.run_id,
    forecast_id: c.forecast_id,
    override_id: c.override_id,
    override_revision: c.revision,
    assessment_line_json: JSON.stringify(orderedJson(p.line)),
  }
  return [...csvReport(Object.keys(fields), [Object.values(fields)])].join('')
}
export const handoffListSpec: ListSpec = {
  ...dispositionListSpec,
  filters: [
    ...dispositionListSpec.filters.filter((f) => f.param !== 'status'),
    { param: 'selection', column: 'selected', kind: 'enum', values: ['current', 'historical'] },
  ],
}
export const handoffListParams = (raw: RawSearchParams) => parseListParams(raw, handoffListSpec)
export const handoffRowSchema = handoffPayloadSchema.shape.disposition.extend({
  id: z.guid(),
  proposal_id: z.guid(),
  assessment_id: z.guid(),
  created_at: z.string(),
  selected: z.boolean(),
})
