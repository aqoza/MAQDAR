import { z } from 'zod'
import { handoffPayloadSchema, handoffJson, handoffListSpec } from './excess-disposition-handoffs'
import { DISPOSITION_KINDS } from './excess-disposition'
import { csvReport } from './imports/report'
import { parseListParams, type ListSpec, type RawSearchParams } from './master-data/list-params'
import { batchSelectionHref as selectionHref } from './handoff-batches'
export { batchInputSchema, batchSelection } from './handoff-batches'

const decimal = z.string().regex(/^\d+(\.\d+)?$/)
export const batchSummarySchema = z.object({
  location_id: z.guid(),
  location_code: z.string(),
  kind: z.enum(DISPOSITION_KINDS),
  currency: z.string().regex(/^[A-Z]{3}$/),
  cutoff: z.iso.date(),
  line_count: z.number().int().min(1).max(50),
  reference_value: decimal,
})
export const batchPreviewSchema = z.object({
  existing_batch_id: z.guid().nullable(),
  summary: batchSummarySchema,
  lines: z.array(handoffPayloadSchema).min(1).max(50),
})
export const batchPayloadSchema = z.object({
  schema_version: z.literal('excess-disposition-handoff-batch-v1'),
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
export const batchRowSchema = batchSummarySchema.extend({
  id: z.guid(),
  created_at: z.string(),
  selection: z.enum(['current', 'historical', 'unavailable']),
  overlap_count: z.number().int(),
})

// Versioned files retain complete original handoffs, never live selection context.
export function batchJson(payload: BatchPayload): string {
  const p = batchPayloadSchema.parse(payload)
  return (
    JSON.stringify({ ...p, lines: p.lines.map((line) => JSON.parse(handoffJson(line))) }, null, 2) +
    '\n'
  )
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
    batch_reference_inventory_value: p.summary.reference_value,
    batch_line_count: p.summary.line_count,
    line_number: index + 1,
    handoff_id: line.handoff_id,
    proposal_id: line.proposal.id,
    proposal_revision: line.proposal.revision,
    assessment_id: line.assessment.id,
    disposition_kind: line.disposition.kind,
    item_id: line.disposition.item_id,
    item_code: line.disposition.item_code,
    location_id: line.disposition.location_id,
    location_code: line.disposition.location_code,
    cutoff: line.disposition.cutoff,
    quantity: line.disposition.quantity,
    unit: line.disposition.unit,
    line_reference_inventory_value: line.disposition.reference_value,
    currency: line.disposition.currency,
    proposal_reason: line.proposal.reason,
    approval_reason: line.proposal.approval_reason,
    assessment_reason: line.assessment.reason,
    original_handoff_json: handoffJson(line).trimEnd(),
  }))
  return [...csvReport(Object.keys(rows[0]), rows.map(Object.values))].join('')
}
export const batchListSpec: ListSpec = {
  ...handoffListSpec,
  filters: [
    ...handoffListSpec.filters.filter((f) => ['location', 'kind'].includes(f.param)),
    {
      param: 'selection',
      column: 'selection',
      kind: 'enum',
      values: ['current', 'historical', 'unavailable'],
    },
    { param: 'cutoff', column: 'cutoff', kind: 'pattern', pattern: /^\d{4}-\d{2}-\d{2}$/ },
  ],
}
export const batchListParams = (raw: RawSearchParams) => parseListParams(raw, batchListSpec)
const errors = {
  batch_selection_invalid: 'invalidSelection',
  batch_source_invalid: 'sourceInvalid',
  batch_group_mismatch: 'groupMismatch',
  batch_duplicate_item: 'duplicateItem',
  handoff_selection_changed: 'selectionChanged',
  excess_disposition_changed: 'evidenceChanged',
} as const
export function batchErrorKey(hint: string | null | undefined) {
  return hint && Object.hasOwn(errors, hint) ? errors[hint as keyof typeof errors] : 'unavailable'
}
export function batchSelectionHref(ids: string[], path = '/replenishment/excess/batches/new') {
  return selectionHref(ids, path)
}
