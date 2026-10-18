import { z } from 'zod'
import { decimalSchema, numberInputValue } from './master-data/numbers'
import type { RawSearchParams } from './master-data/list-params'
import { batchSummarySchema } from './handoff-batches'

const capacity = decimalSchema({ scale: 6, integerDigits: 9, greaterThan: 0 }).transform(
  numberInputValue,
)
export const capacityInputSchema = z.object({
  batch: z.guid(),
  volume: capacity,
  payload: capacity,
  confirmed: z.enum(['true', 'false']),
})
export const capacitySaveSchema = capacityInputSchema.extend({
  request_id: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export function capacityParams(raw: RawSearchParams) {
  const first = (key: string) => (Array.isArray(raw[key]) ? raw[key][0] : raw[key])
  return {
    batch: first('batch'),
    volume: first('volume') ?? '',
    payload: first('payload') ?? '',
    confirmed: first('confirmed') ?? 'false',
  }
}
export const capacityStatuses = [
  'available',
  'selection_changed',
  'source_invalid',
  'measurements_missing',
  'unit_unknown',
  'unit_mismatch',
  'date_unknown',
  'not_effective',
  'unconfirmed',
] as const
const decimal = z.string().regex(/^\d+(\.\d+)?$/)
export const capacityReportSchema = z.object({
  method: z.literal('container-capacity-v1'),
  batch_id: z.guid(),
  location_id: z.guid(),
  summary: batchSummarySchema,
  confirmed: z.boolean(),
  selected: z.boolean(),
  volume_limit_m3: decimal,
  payload_limit_kg: decimal,
  status: z.enum(['available', 'unavailable']),
  totals: z
    .object({
      weight_kg: decimal,
      volume_m3: decimal,
      weight_utilization_pct: decimal,
      volume_utilization_pct: decimal,
      weight_over_kg: decimal,
      volume_over_m3: decimal,
      within_limits: z.boolean(),
    })
    .nullable(),
  lines: z
    .array(
      z.object({
        handoff_id: z.guid(),
        proposal_id: z.guid(),
        item_id: z.guid(),
        item_code: z.string(),
        unit: z.string().nullable(),
        quantity: decimal,
        order_date: z.iso.date(),
        receipt_date: z.iso.date(),
        selected: z.boolean(),
        status: z.enum(capacityStatuses),
        measurement: z
          .object({
            id: z.guid(),
            unit: z.string().nullable(),
            weight_kg: decimal.nullable(),
            volume_m3: decimal.nullable(),
            valid_from: z.iso.date().nullable(),
            updated_at: z.string(),
          })
          .nullable(),
        weight_kg: decimal.nullable(),
        volume_m3: decimal.nullable(),
      }),
    )
    .min(1)
    .max(50),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export type CapacityReport = z.infer<typeof capacityReportSchema>
