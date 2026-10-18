import { z } from 'zod'
import { handoffPayloadSchema, handoffListSpec, handoffCsvFields } from './transfer-handoffs'
import { csvReport } from './imports/report'
import { parseListParams, type RawSearchParams } from './master-data/list-params'

export const batchInputSchema = z
  .array(z.guid())
  .min(1)
  .max(50)
  .refine((ids) => new Set(ids).size === ids.length)
export const batchSummarySchema = z.object({
  lane_id: z.guid(),
  source_location_id: z.guid(),
  source_code: z.string(),
  location_id: z.guid(),
  location_code: z.string(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  minor_units: z.number().int().min(0).max(3),
  dispatch_date: z.iso.date(),
  line_count: z.number().int().min(1).max(50),
  subtotal: z.string().regex(/^\d+(\.\d+)?$/),
})
export const batchPreviewSchema = z.object({
  existing_batch_id: z.guid().nullable(),
  summary: batchSummarySchema,
  lines: z.array(handoffPayloadSchema).min(1).max(50),
})
export const batchPayloadSchema = z.object({
  schema_version: z.literal('transfer-handoff-batch-v1'),
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
    batch_schema_version: p.schema_version,
    batch_id: p.batch_id,
    batch_created_at: p.created_at,
    batch_created_by: p.created_by,
    batch_notice: p.notice,
    batch_subtotal: p.summary.subtotal,
    batch_line_count: p.summary.line_count,
    line_number: index + 1,
    ...handoffCsvFields(line),
  }))
  return [...csvReport(Object.keys(rows[0]), rows.map(Object.values))].join('')
}
export const batchListSpec = handoffListSpec
export const batchListParams = (raw: RawSearchParams) => parseListParams(raw, batchListSpec)
export const batchRowSchema = z.object({
  id: z.guid(),
  created_at: z.string(),
  source_code: z.string(),
  location_code: z.string(),
  currency: z.string(),
  minor_units: z.number().int(),
  subtotal: z.string(),
  dispatch_date: z.iso.date(),
  line_count: z.number().int(),
  selected: z.boolean(),
  overlap_count: z.number().int(),
})
export const batchErrorKeys = {
  batch_selection_invalid: 'invalidSelection',
  batch_source_invalid: 'sourceInvalid',
  batch_group_mismatch: 'groupMismatch',
  batch_duplicate_item: 'duplicateItem',
  transfer_selection_changed: 'selectionChanged',
  transfer_freight_changed: 'priceChanged',
  transfer_timing_required: 'policyRequired',
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
export function batchSelectionHref(
  ids: string[],
  path = '/replenishment/redistribution/batches/new',
) {
  const params = new URLSearchParams()
  ids.forEach((id) => params.append('handoff', id))
  return ids.length ? `${path}?${params}` : path
}
