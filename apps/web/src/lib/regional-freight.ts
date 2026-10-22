import { z } from 'zod'
import { regionalDateReportSchema } from './regional-dates'
import {
  transferFreightInputSchema,
  transferFreightSaveSchema,
  transferFreightParams,
  transferFreightRpcInput,
  transferFreightReportSchema,
  transferFreightListSpec,
} from './transfer-freight'
import { parseListParams, type RawSearchParams } from './master-data/list-params'

export const regionalFreightInputSchema = transferFreightInputSchema
export const regionalFreightSaveSchema = transferFreightSaveSchema
export const regionalFreightParams = transferFreightParams
export const regionalFreightRpcInput = transferFreightRpcInput
export const regionalFreightPath = '/replenishment/regional-stock/sourcing/freight'
const decimal = z.string().regex(/^\d+(\.\d+)?$/)
export const regionalFreightReportSchema = transferFreightReportSchema
  .pick({
    scenario_id: true,
    terms_confirmed: true,
    receiver: true,
    rounding: true,
    fingerprint: true,
  })
  .extend({
    method: z.literal('regional-freight-v1'),
    status: z.enum([
      'available',
      'no_transfer_needed',
      'source_unavailable',
      'destination_location_unavailable',
      'line_unavailable',
    ]),
    source: regionalDateReportSchema,
    lines: z
      .array(
        transferFreightReportSchema
          .pick({
            status: true,
            sender: true,
            terms: true,
            shipment_count: true,
            exact_product: true,
            subtotal: true,
          })
          .extend({
            dispatch_date: z.iso.date().nullable(),
            location_id: z.guid(),
            location_code: z.string(),
            quantity: decimal,
          }),
      )
      .min(1)
      .max(19),
    totals: z.array(
      z.object({
        currency: z.string().length(3),
        minor_units: z.number().int().min(0).max(3),
        subtotal: decimal,
      }),
    ),
  })
export type RegionalFreightReport = z.infer<typeof regionalFreightReportSchema>
export const canSaveRegionalFreight = (status: RegionalFreightReport['status']) =>
  status === 'available' || status === 'no_transfer_needed'
export const regionalFreightListSpec = transferFreightListSpec
export const regionalFreightListParams = (raw: RawSearchParams) =>
  parseListParams(raw, regionalFreightListSpec)
