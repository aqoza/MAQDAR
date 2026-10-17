import { z } from 'zod'
import { normalizeDigits } from './master-data/numbers'
import {
  firstParam,
  parseListParams,
  type ListSpec,
  type RawSearchParams,
} from './master-data/list-params'
import { comparisonSchema } from './stock-comparison'
import { replenishmentReportSchema } from './replenishment'

export const redistributionStatuses = [
  'available',
  'destination_unavailable',
  'source_unavailable',
  'prepared_group',
  'same_location',
  'item_mismatch',
  'cutoff_mismatch',
  'unit_mismatch',
  'stock_date_mismatch',
  'lane_missing',
  'lane_inactive',
  'commitments_unconfirmed',
  'lane_unconfirmed',
] as const
const decimal = z.string().regex(/^-?\d+(\.\d+)?$/)
export const redistributionInputSchema = z.object({
  draft: z.uuid(),
  policy: z.uuid(),
  maximum: z.union([z.literal('calculated'), z.uuid()]),
  backorders: z
    .string()
    .transform(normalizeDigits)
    .pipe(z.string().regex(/^\d{1,15}(\.\d{1,3})?$/)),
  commitments: z.enum(['true', 'false']),
  lane: z.enum(['true', 'false']),
})
export const redistributionSaveSchema = redistributionInputSchema.extend({
  commitments: z.literal('true'),
  lane: z.literal('true'),
  request_id: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export function redistributionParams(raw: RawSearchParams) {
  return {
    draft: firstParam(raw.draft),
    policy: firstParam(raw.policy),
    maximum: firstParam(raw.maximum),
    backorders: firstParam(raw.backorders),
    commitments: firstParam(raw.commitments) ?? 'false',
    lane: firstParam(raw.lane) ?? 'false',
  }
}
export function redistributionRpcInput(input: z.infer<typeof redistributionInputSchema>) {
  return {
    p_draft_id: input.draft,
    p_source_policy_id: input.policy,
    p_basis: input.maximum === 'calculated' ? 'calculated' : 'approved',
    p_override_id: input.maximum === 'calculated' ? undefined : input.maximum,
    p_backorders: input.backorders,
    p_commitments_confirmed: input.commitments === 'true',
    p_lane_confirmed: input.lane === 'true',
  }
}
export const redistributionReportSchema = z.object({
  method: z.literal('redistribution-quantity-v1'),
  status: z.enum(redistributionStatuses),
  draft_id: z.uuid(),
  location_id: z.uuid(),
  source_location_id: z.uuid(),
  source_policy_id: z.uuid(),
  source_item_id: z.uuid(),
  source_location_code: z.string(),
  source_policy: comparisonSchema.nullable(),
  destination: replenishmentReportSchema,
  backorders: decimal,
  commitments_confirmed: z.boolean(),
  lane_confirmed: z.boolean(),
  basis: z.enum(['calculated', 'approved']),
  override_id: z.uuid().nullable(),
  source_surplus: decimal.nullable(),
  quantity: decimal.nullable(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  lane: z
    .object({
      id: z.uuid(),
      active: z.boolean(),
      from_location_id: z.uuid(),
      to_location_id: z.uuid(),
      lead_time_days_p50: z.number().int(),
      lead_time_days_p90: z.number().int(),
      freight_basis: z.enum(['none', 'per_unit', 'per_shipment']),
      freight_cost: decimal.nullable(),
      currency: z.string().nullable(),
      updated_at: z.string(),
    })
    .nullable(),
})
export type RedistributionReport = z.infer<typeof redistributionReportSchema>
export const redistributionListSpec: ListSpec = {
  sorts: ['created_at'],
  defaultSort: 'created_at',
  defaultDir: 'desc',
  tiebreak: 'id',
  search: true,
  filters: [{ param: 'draft', column: 'draft_id', kind: 'uuid' }],
}
export const redistributionListParams = (raw: RawSearchParams) =>
  parseListParams(raw, redistributionListSpec)
