import { z } from 'zod'
import { networkReportSchema } from './network-allocation'
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

export const networkDateInputSchema = transferDateInputSchema.omit({ draft: true }).extend({
  allocation: z.guid(),
})
export const networkDateSaveSchema = networkDateInputSchema.extend({
  request_id: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export function networkDateParams(raw: RawSearchParams) {
  return {
    allocation: firstParam(raw.allocation),
    requested: firstParam(raw.requested),
    confirmed: firstParam(raw.confirmed) ?? 'false',
  }
}
export function networkDateRpcInput(input: z.infer<typeof networkDateInputSchema>) {
  return {
    p_allocation_id: input.allocation,
    p_requested_date: input.requested,
    p_calendars_confirmed: input.confirmed === 'true',
  }
}
export const networkDateReportSchema = transferDateReportSchema
  .pick({
    requested_date: true,
    calendars_confirmed: true,
    sender: true,
    source_calendar: true,
    dispatch: true,
    fingerprint: true,
    source_location_id: true,
  })
  .extend({
    method: z.literal('network-dates-v1'),
    status: z.enum([
      'available',
      'no_transfer_needed',
      'source_unavailable',
      'source_location_unavailable',
      'calendars_unconfirmed',
      'dispatch_unavailable',
      'line_unavailable',
    ]),
    allocation_id: z.guid(),
    source: networkReportSchema,
    lines: z
      .array(
        z.object({
          location_id: z.guid(),
          location_code: z.string(),
          quantity: z.string().regex(/^\d+(\.\d+)?$/),
          status: z.enum(transferDateStatuses),
          policy_reference: z
            .object({
              id: z.guid(),
              cutoff: z.iso.date(),
              unit: z.string(),
              lead_time: z.number().int().nullable(),
              review_interval: z.number().int().nullable(),
            })
            .nullable(),
          timing_reference_date: z.iso.date().nullable(),
          receiver: transferDateReportSchema.shape.receiver,
          lane: transferDateReportSchema.shape.lane,
          receipts: z.object({
            p50: transferReceiptSchema.optional(),
            p90: transferReceiptSchema.optional(),
          }),
        }),
      )
      .min(1)
      .max(20),
  })
export type NetworkDateReport = z.infer<typeof networkDateReportSchema>
export const canSaveNetworkDates = (status: NetworkDateReport['status']) =>
  status === 'available' || status === 'no_transfer_needed'
export const networkDateListSpec: ListSpec = {
  sorts: ['created_at'],
  defaultSort: 'created_at',
  defaultDir: 'desc',
  tiebreak: 'id',
  search: true,
  filters: [{ param: 'allocation', column: 'allocation_id', kind: 'uuid' }],
}
export const networkDateListParams = (raw: RawSearchParams) =>
  parseListParams(raw, networkDateListSpec)
