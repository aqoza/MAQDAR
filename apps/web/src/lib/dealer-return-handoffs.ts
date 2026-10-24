import { z } from 'zod'
import { dealerReturnReportSchema, dealerReturnsPath } from './dealer-returns'
import { csvReport } from './imports/report'
import { parseListParams, type ListSpec, type RawSearchParams } from './master-data/list-params'

export const returnHandoffsPath = dealerReturnsPath + '/handoffs'
export const returnHandoffPayloadSchema = z.object({
  schema_version: z.literal('dealer-return-handoff-v1'),
  purpose: z.literal('internal_return_authorization'),
  notice: z.string(),
  handoff_id: z.guid(),
  organization_id: z.guid(),
  created_at: z.string(),
  created_by: z.guid(),
  created_by_email: z.string().nullable(),
  request: z.object({
    id: z.guid(),
    created_at: z.string(),
    submitted_by: z.guid(),
    report: dealerReturnReportSchema,
  }),
  approval: z.object({
    decision: z.literal('approved'),
    decided_at: z.string(),
    decided_by: z.guid(),
    reviewer_email: z.string().nullable(),
    reason: z.string(),
    eligibility_confirmed: z.literal(true),
  }),
})
export type ReturnHandoffPayload = z.infer<typeof returnHandoffPayloadSchema>

// Versioned encoding: retain v1 field order and exact quantity strings on future changes.
export function returnHandoffJson(payload: ReturnHandoffPayload) {
  return JSON.stringify(returnHandoffPayloadSchema.parse(payload), null, 2) + '\n'
}
export function returnHandoffCsv(payload: ReturnHandoffPayload) {
  const p = returnHandoffPayloadSchema.parse(payload)
  const r = p.request.report
  const fields = {
    schema_version: p.schema_version,
    purpose: p.purpose,
    notice: p.notice,
    handoff_id: p.handoff_id,
    organization_id: p.organization_id,
    created_at: p.created_at,
    created_by: p.created_by,
    created_by_email: p.created_by_email,
    return_request_id: p.request.id,
    requested_by: p.request.submitted_by,
    requested_by_email: r.author,
    request_created_at: p.request.created_at,
    item_id: r.item.id,
    item_code: r.item.code,
    item_name_en: r.item.name_en,
    item_name_ar: r.item.name_ar,
    recorded_item_status: r.item.status,
    source_location_id: r.source.id,
    source_location_code: r.source.code,
    source_name_en: r.source.name_en,
    source_name_ar: r.source.name_ar,
    source_location_type: r.source.location_type,
    receiving_location_id: r.receiver.id,
    receiving_location_code: r.receiver.code,
    receiving_name_en: r.receiver.name_en,
    receiving_name_ar: r.receiver.name_ar,
    receiving_location_type: r.receiver.location_type,
    declared_quantity: r.input.quantity,
    unit: r.input.unit,
    requested_return_date: r.input.requested_date,
    declared_condition: r.input.condition,
    request_reason: r.input.reason,
    original_sale_reference: r.input.sale_reference,
    declaration_confirmed: r.input.confirmed,
    decision: p.approval.decision,
    approved_at: p.approval.decided_at,
    approved_by: p.approval.decided_by,
    reviewer_email: p.approval.reviewer_email,
    eligibility_rationale: p.approval.reason,
    eligibility_confirmed: p.approval.eligibility_confirmed,
  }
  return [...csvReport(Object.keys(fields), [Object.values(fields)])].join('')
}
export const returnHandoffListSpec = {
  sorts: ['created_at'],
  defaultSort: 'created_at',
  defaultDir: 'desc',
  tiebreak: 'id',
  search: true,
  filters: [],
} satisfies ListSpec
export const returnHandoffParams = (raw: RawSearchParams) =>
  parseListParams({ ...raw, dir: 'desc' }, returnHandoffListSpec)
