import { z } from 'zod'
import { handoffPayloadSchema, handoffCsvRows } from './network-handoffs'
import { networkFreightReportSchema } from './network-freight'
import { csvReport } from './imports/report'
import { parseListParams, type ListSpec, type RawSearchParams } from './master-data/list-params'
export { batchInputSchema, batchSelection } from './transfer-batches'
import { batchSelectionHref as selectionHref } from './transfer-batches'

export const batchSummarySchema = z.object({
  source_location_id: z.guid(),
  source_code: z.string(),
  dispatch_date: z.iso.date(),
  handoff_count: z.number().int().min(1).max(50),
  branch_row_count: z.number().int().min(1).max(1000),
  totals: networkFreightReportSchema.shape.totals,
})
export const batchPreviewSchema = z.object({
  existing_batch_id: z.guid().nullable(),
  summary: batchSummarySchema,
  lines: z.array(handoffPayloadSchema).min(1).max(50),
})
export const batchPayloadSchema = z.object({
  schema_version: z.literal('network-handoff-batch-v1'),
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

// Versioned snapshots pin complete source handoffs and exact decimal text.
export function batchJson(payload: BatchPayload): string {
  return JSON.stringify(batchPayloadSchema.parse(payload), null, 2) + '\n'
}
export function batchCsv(payload: BatchPayload): string {
  const p = batchPayloadSchema.parse(payload)
  const rows = p.lines.flatMap((line, index) =>
    handoffCsvRows(line).map((row, branchIndex) => ({
      batch_schema_version: p.schema_version,
      batch_id: p.batch_id,
      batch_created_at: p.created_at,
      batch_created_by: p.created_by,
      batch_notice: p.notice,
      batch_totals_json: JSON.stringify(p.summary.totals),
      batch_handoff_count: p.summary.handoff_count,
      batch_branch_row_count: p.summary.branch_row_count,
      handoff_number: index + 1,
      branch_number: branchIndex + 1,
      ...row,
    })),
  )
  return [...csvReport(Object.keys(rows[0]), rows.map(Object.values))].join('')
}
export const batchListSpec: ListSpec = {
  sorts: ['created_at'],
  defaultSort: 'created_at',
  defaultDir: 'desc',
  tiebreak: 'id',
  search: true,
  filters: [
    { param: 'source', column: 'source_code', kind: 'pattern', pattern: /^[A-Za-z0-9_.-]{1,64}$/ },
    {
      param: 'selection',
      column: 'selection',
      kind: 'enum',
      values: ['current', 'historical', 'unavailable'],
    },
  ],
}
export const batchListParams = (raw: RawSearchParams) => parseListParams(raw, batchListSpec)
export const batchRowSchema = batchSummarySchema.omit({ source_location_id: true }).extend({
  id: z.guid(),
  created_at: z.string(),
  selection: z.enum(['current', 'historical', 'unavailable']),
  overlap_count: z.number().int(),
})
const errorKeys = {
  batch_selection_invalid: 'invalidSelection',
  batch_source_invalid: 'sourceInvalid',
  batch_group_mismatch: 'groupMismatch',
  batch_duplicate_item: 'duplicateItem',
  network_selection_changed: 'selectionChanged',
  network_freight_changed: 'priceChanged',
  network_timing_required: 'policyRequired',
} as const
export function batchErrorKey(hint: string | undefined | null) {
  return hint && Object.hasOwn(errorKeys, hint)
    ? errorKeys[hint as keyof typeof errorKeys]
    : 'unavailable'
}
export function batchSelectionHref(ids: string[], path = '/replenishment/network/batches/new') {
  return selectionHref(ids, path)
}
