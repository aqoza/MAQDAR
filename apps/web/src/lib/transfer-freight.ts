import { z } from 'zod'
import { calendarEntitySchema } from './delivery-scenarios'
import { transferDateReportSchema } from './transfer-dates'
import {
  firstParam,
  parseListParams,
  type ListSpec,
  type RawSearchParams,
} from './master-data/list-params'

export const transferFreightStatuses = [
  'available',
  'no_transfer_needed',
  'source_unavailable',
  'source_location_unavailable',
  'destination_location_unavailable',
  'lane_unavailable',
  'lane_changed',
  'freight_unconfigured',
  'unit_unknown',
  'unit_mismatch',
  'rate_invalid',
  'rate_date_unknown',
  'rate_not_effective',
  'terms_unconfirmed',
  'amount_out_of_range',
] as const
export const transferFreightInputSchema = z.object({
  scenario: z.guid(),
  confirmed: z.enum(['true', 'false']),
})
export const transferFreightSaveSchema = transferFreightInputSchema.extend({
  request_id: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export function transferFreightParams(raw: RawSearchParams) {
  return { scenario: firstParam(raw.scenario), confirmed: firstParam(raw.confirmed) ?? 'false' }
}
export function transferFreightRpcInput(input: z.infer<typeof transferFreightInputSchema>) {
  return { p_scenario_id: input.scenario, p_terms_confirmed: input.confirmed === 'true' }
}
const decimal = z.string().regex(/^\d+(\.\d+)?$/)
export const transferFreightReportSchema = z.object({
  method: z.literal('transfer-freight-v1'),
  status: z.enum(transferFreightStatuses),
  scenario_id: z.guid(),
  location_id: z.guid(),
  source_location_id: z.guid(),
  source: transferDateReportSchema,
  terms_confirmed: z.boolean(),
  sender: calendarEntitySchema.nullable(),
  receiver: calendarEntitySchema.nullable(),
  terms: z
    .object({
      id: z.guid(),
      active: z.boolean(),
      from_location_id: z.guid(),
      to_location_id: z.guid(),
      lead_time_days_p50: z.number().int(),
      lead_time_days_p90: z.number().int(),
      basis: z.enum(['none', 'per_unit', 'per_shipment']),
      rate: decimal.nullable(),
      raw_rate: z.string().nullable(),
      currency: z.string().nullable(),
      minor_units: z.number().int().min(0).max(3).nullable(),
      unit: z.string().nullable(),
      valid_from: z.string().nullable(),
      updated_at: z.string(),
    })
    .nullable(),
  shipment_count: z.literal(1).nullable(),
  exact_product: decimal.nullable(),
  subtotal: decimal.nullable(),
  rounding: z.literal('half-up-currency-minor-units'),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export type TransferFreightReport = z.infer<typeof transferFreightReportSchema>
export const canSaveTransferFreight = (status: TransferFreightReport['status']) =>
  status === 'available' || status === 'no_transfer_needed'
export const transferFreightListSpec: ListSpec = {
  sorts: ['created_at'],
  defaultSort: 'created_at',
  defaultDir: 'desc',
  tiebreak: 'id',
  search: true,
  filters: [{ param: 'scenario', column: 'scenario_id', kind: 'uuid' }],
}
export const transferFreightListParams = (raw: RawSearchParams) =>
  parseListParams(raw, transferFreightListSpec)
