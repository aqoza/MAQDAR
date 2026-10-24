import { z } from 'zod'
import { returnHandoffPayloadSchema, returnHandoffJson } from './dealer-return-handoffs'
import { dealerReturnsPath } from './dealer-returns'
import { csvReport } from './imports/report'
import { batchSelectionHref as selectionHref } from './handoff-batches'
import { parseListParams, type ListSpec, type RawSearchParams } from './master-data/list-params'
export { batchInputSchema, batchSelection } from './handoff-batches'

export const returnBatchesPath = dealerReturnsPath + '/batches'
export const returnBatchSummarySchema = z.object({
  source_location_id: z.guid(),
  source_code: z.string(),
  location_id: z.guid(),
  location_code: z.string(),
  requested_date: z.iso.date(),
  line_count: z.number().int().min(1).max(50),
})
export const returnBatchPreviewSchema = z.object({
  existing_batch_id: z.guid().nullable(),
  summary: returnBatchSummarySchema,
  lines: z.array(returnHandoffPayloadSchema).min(1).max(50),
})
export const returnBatchPayloadSchema = z.object({
  schema_version: z.literal('dealer-return-batch-v1'),
  purpose: z.literal('internal_return_authorization'),
  notice: z.string(),
  batch_id: z.guid(),
  organization_id: z.guid(),
  created_by: z.guid(),
  created_by_email: z.string().nullable(),
  created_at: z.string(),
  summary: returnBatchSummarySchema,
  lines: z.array(returnHandoffPayloadSchema).min(1).max(50),
})
export type ReturnBatchPreview = z.infer<typeof returnBatchPreviewSchema>
export type ReturnBatchPayload = z.infer<typeof returnBatchPayloadSchema>

// Preserve v1 file order and exact quantities; live source/overlap context is excluded.
export function returnBatchJson(payload: ReturnBatchPayload) {
  const p = returnBatchPayloadSchema.parse(payload)
  return (
    JSON.stringify(
      { ...p, lines: p.lines.map((line) => JSON.parse(returnHandoffJson(line))) },
      null,
      2,
    ) + '\n'
  )
}
export function returnBatchCsv(payload: ReturnBatchPayload) {
  const p = returnBatchPayloadSchema.parse(payload)
  const rows = p.lines.map((line, index) => {
    const r = line.request.report
    return {
      schema_version: p.schema_version,
      purpose: p.purpose,
      notice: p.notice,
      batch_id: p.batch_id,
      organization_id: p.organization_id,
      created_at: p.created_at,
      created_by: p.created_by,
      created_by_email: p.created_by_email,
      batch_line_count: p.summary.line_count,
      line_number: index + 1,
      handoff_id: line.handoff_id,
      request_id: line.request.id,
      item_id: r.item.id,
      item_code: r.item.code,
      source_location_id: r.source.id,
      source_code: r.source.code,
      receiving_location_id: r.receiver.id,
      receiving_code: r.receiver.code,
      declared_quantity: r.input.quantity,
      unit: r.input.unit,
      declared_condition: r.input.condition,
      requested_return_date: r.input.requested_date,
      original_sale_reference: r.input.sale_reference,
      request_reason: r.input.reason,
      approved_at: line.approval.decided_at,
      approved_by: line.approval.decided_by,
      eligibility_rationale: line.approval.reason,
      original_handoff_json: returnHandoffJson(line).trimEnd(),
    }
  })
  return [...csvReport(Object.keys(rows[0]), rows.map(Object.values))].join('')
}
export const returnBatchListSpec = {
  sorts: ['created_at'],
  defaultSort: 'created_at',
  defaultDir: 'desc',
  tiebreak: 'id',
  search: true,
  filters: [],
} satisfies ListSpec
export const returnBatchParams = (raw: RawSearchParams) =>
  parseListParams({ ...raw, dir: 'desc' }, returnBatchListSpec)
export const returnBatchSelectionHref = (ids: string[], path = returnBatchesPath + '/new') =>
  selectionHref(ids, path)
const errors = {
  batch_selection_invalid: 'invalidSelection',
  batch_group_mismatch: 'groupMismatch',
  batch_duplicate_item: 'duplicateItem',
  return_evidence_changed: 'evidenceChanged',
} as const
export function returnBatchErrorKey(hint: string | null | undefined) {
  return hint && Object.hasOwn(errors, hint) ? errors[hint as keyof typeof errors] : 'unavailable'
}
