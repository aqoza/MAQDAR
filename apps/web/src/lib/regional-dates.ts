import { z } from 'zod'
import { regionalSourcingPath, regionalSourcingReportSchema } from './regional-sourcing'
import {
  transferDateInputSchema,
  transferDateReportSchema,
  transferDateStatuses,
  transferReceiptSchema,
} from './transfer-dates'
import {
  firstParam,
  parseListParams,
  type ListSpec,
  type RawSearchParams,
} from './master-data/list-params'

export const regionalDatePath = `${regionalSourcingPath}/dates`
export const regionalDateInputSchema = transferDateInputSchema
  .omit({ draft: true })
  .extend({ sourcing: z.guid() })
export const regionalDateSaveSchema = regionalDateInputSchema.extend({
  request_id: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export function regionalDateParams(raw: RawSearchParams) {
  return {
    sourcing: firstParam(raw.sourcing),
    requested: firstParam(raw.requested),
    confirmed: firstParam(raw.confirmed) ?? 'false',
  }
}
export function regionalDateRpcInput(input: z.infer<typeof regionalDateInputSchema>) {
  return {
    p_sourcing_id: input.sourcing,
    p_requested_date: input.requested,
    p_calendars_confirmed: input.confirmed === 'true',
  }
}
export const regionalDateReportSchema = transferDateReportSchema
  .pick({
    requested_date: true,
    calendars_confirmed: true,
    receiver: true,
    fingerprint: true,
    timing_reference_date: true,
  })
  .extend({
    method: z.literal('regional-dates-v1'),
    status: z.enum([
      'available',
      'no_transfer_needed',
      'source_unavailable',
      'destination_location_unavailable',
      'destination_policy_unavailable',
      'calendars_unconfirmed',
      'line_unavailable',
    ]),
    sourcing_id: z.guid(),
    source: regionalSourcingReportSchema,
    policy_reference: z
      .object({
        id: z.guid(),
        cutoff: z.iso.date(),
        unit: z.string(),
        lead_time: z.number().int().nullable(),
        review_interval: z.number().int().nullable(),
      })
      .nullable(),
    lines: z
      .array(
        transferDateReportSchema
          .pick({ sender: true, lane: true, source_calendar: true, dispatch: true })
          .extend({
            location_id: z.guid(),
            location_code: z.string(),
            quantity: z.string().regex(/^\d+(\.\d+)?$/),
            status: z.enum(transferDateStatuses),
            receipts: z.object({
              p50: transferReceiptSchema.optional(),
              p90: transferReceiptSchema.optional(),
            }),
          }),
      )
      .min(1)
      .max(19),
  })
export type RegionalDateReport = z.infer<typeof regionalDateReportSchema>
export const canSaveRegionalDates = (status: RegionalDateReport['status']) =>
  status === 'available' || status === 'no_transfer_needed'
export const regionalDateListSpec: ListSpec = {
  sorts: ['created_at'],
  defaultSort: 'created_at',
  defaultDir: 'desc',
  tiebreak: 'id',
  search: true,
  filters: [{ param: 'sourcing', column: 'sourcing_id', kind: 'uuid' }],
}
export const regionalDateListParams = (raw: RawSearchParams) =>
  parseListParams(raw, regionalDateListSpec)
