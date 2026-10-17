import { z } from 'zod'
import {
  calendarEntitySchema,
  calendarEvidenceSchema,
  calendarSearchSchema,
} from './delivery-scenarios'
import { redistributionReportSchema } from './redistribution'
import {
  firstParam,
  parseListParams,
  type ListSpec,
  type RawSearchParams,
} from './master-data/list-params'

export const transferDateStatuses = [
  'available',
  'no_transfer_needed',
  'source_unavailable',
  'source_location_unavailable',
  'destination_location_unavailable',
  'lane_unavailable',
  'lane_changed',
  'destination_policy_unavailable',
  'calendars_unconfirmed',
  'dispatch_unavailable',
  'receipt_unavailable',
] as const
export const transferDateInputSchema = z.object({
  draft: z.uuid(),
  requested: z.iso.date().refine((date) => date >= '1900-01-01' && date <= '2100-12-31'),
  confirmed: z.enum(['true', 'false']),
})
export const transferDateSaveSchema = transferDateInputSchema.extend({
  request_id: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export function transferDateParams(raw: RawSearchParams) {
  return {
    draft: firstParam(raw.draft),
    requested: firstParam(raw.requested),
    confirmed: firstParam(raw.confirmed) ?? 'false',
  }
}
export function transferDateRpcInput(input: z.infer<typeof transferDateInputSchema>) {
  return {
    p_redistribution_id: input.draft,
    p_requested_date: input.requested,
    p_calendars_confirmed: input.confirmed === 'true',
  }
}
export const transferReceiptSchema = z.object({
  lead_time: z.number().int().min(0).max(3650),
  nominal_date: z.iso.date(),
  calendar: calendarEvidenceSchema,
  search: calendarSearchSchema,
  timing_review_required: z.boolean().nullable(),
})
export const transferDateReportSchema = z.object({
  method: z.literal('transfer-dates-v1'),
  status: z.enum(transferDateStatuses),
  redistribution_id: z.uuid(),
  location_id: z.uuid(),
  source_location_id: z.uuid(),
  source: redistributionReportSchema,
  requested_date: z.iso.date(),
  calendars_confirmed: z.boolean(),
  destination_lead_time: z.number().int().nullable(),
  timing_reference_date: z.iso.date().nullable(),
  sender: calendarEntitySchema.nullable(),
  receiver: calendarEntitySchema.nullable(),
  lane: z
    .object({
      id: z.uuid(),
      active: z.boolean(),
      from_location_id: z.uuid(),
      to_location_id: z.uuid(),
      lead_time_days_p50: z.number().int(),
      lead_time_days_p90: z.number().int(),
      updated_at: z.string(),
    })
    .nullable(),
  source_calendar: calendarEvidenceSchema.nullable(),
  dispatch: calendarSearchSchema.nullable(),
  receipts: z.object({
    p50: transferReceiptSchema.optional(),
    p90: transferReceiptSchema.optional(),
  }),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export type TransferDateReport = z.infer<typeof transferDateReportSchema>
export const canSaveTransferDates = (status: TransferDateReport['status']) =>
  status === 'available' || status === 'no_transfer_needed'
export const transferDateListSpec: ListSpec = {
  sorts: ['created_at'],
  defaultSort: 'created_at',
  defaultDir: 'desc',
  tiebreak: 'id',
  search: true,
  filters: [{ param: 'draft', column: 'redistribution_id', kind: 'uuid' }],
}
export const transferDateListParams = (raw: RawSearchParams) =>
  parseListParams(raw, transferDateListSpec)
