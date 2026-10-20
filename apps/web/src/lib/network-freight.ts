import { z } from 'zod'
import { networkDateReportSchema } from './network-dates'
import {
  transferFreightInputSchema,
  transferFreightSaveSchema,
  transferFreightParams,
  transferFreightRpcInput,
  transferFreightReportSchema,
  transferFreightListSpec,
} from './transfer-freight'
import { parseListParams, type RawSearchParams } from './master-data/list-params'

export const networkFreightInputSchema = transferFreightInputSchema
export const networkFreightSaveSchema = transferFreightSaveSchema
export const networkFreightParams = transferFreightParams
export const networkFreightRpcInput = transferFreightRpcInput
const decimal = z.string().regex(/^\d+(\.\d+)?$/)
export const networkFreightReportSchema = transferFreightReportSchema
  .pick({
    scenario_id: true,
    source_location_id: true,
    terms_confirmed: true,
    sender: true,
    rounding: true,
    fingerprint: true,
  })
  .extend({
    method: z.literal('network-freight-v1'),
    status: z.enum([
      'available',
      'no_transfer_needed',
      'source_unavailable',
      'source_location_unavailable',
      'line_unavailable',
    ]),
    source: networkDateReportSchema,
    lines: z
      .array(
        transferFreightReportSchema
          .pick({
            status: true,
            receiver: true,
            terms: true,
            shipment_count: true,
            exact_product: true,
            subtotal: true,
          })
          .extend({
            location_id: z.guid(),
            location_code: z.string(),
            quantity: decimal,
          }),
      )
      .min(1)
      .max(20),
    totals: z.array(
      z.object({
        currency: z.string().length(3),
        minor_units: z.number().int().min(0).max(3),
        subtotal: decimal,
      }),
    ),
  })
export type NetworkFreightReport = z.infer<typeof networkFreightReportSchema>
export const canSaveNetworkFreight = (status: NetworkFreightReport['status']) =>
  status === 'available' || status === 'no_transfer_needed'
export const networkFreightListSpec = transferFreightListSpec
export const networkFreightListParams = (raw: RawSearchParams) =>
  parseListParams(raw, networkFreightListSpec)
