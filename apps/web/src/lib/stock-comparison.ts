import { z } from 'zod'
import type { RawSearchParams } from './master-data/list-params'

export const unitProvenanceSchema = z.object({
  method: z.literal('source-units-v1'),
  status: z.enum(['consistent', 'unknown', 'conflicting']),
  unit: z.enum(['EA', 'SET', 'L', 'KG']).nullable(),
  rows: z.number().int().nonnegative(),
  unknown_rows: z.number().int().nonnegative(),
  units: z.array(z.enum(['EA', 'SET', 'L', 'KG'])),
})
const decimal = z.string().regex(/^-?\d+(\.\d+)?$/)
export const comparisonSchema = z.object({
  status: z.enum([
    'available',
    'policy_unavailable',
    'prepared_group',
    'date_mismatch',
    'policy_unit_unknown',
    'stock_missing',
    'stock_stale',
    'stock_unit_unknown',
    'unit_mismatch',
  ]),
  policy_id: z.uuid(),
  run_id: z.uuid(),
  forecast_id: z.uuid(),
  item_code: z.string(),
  location_code: z.string(),
  day: z.iso.date(),
  cutoff: z.iso.date(),
  unit: z.string().nullable(),
  unit_provenance: unitProvenanceSchema.nullable(),
  basis: z.enum(['calculated', 'approved']),
  override_id: z.uuid().nullable(),
  revision: z.number().int().nullable(),
  maximum: decimal.nullable(),
  quantity_above: decimal.nullable(),
  value_above: decimal.nullable(),
  snapshot: z
    .object({
      id: z.uuid(),
      date: z.iso.date(),
      updated_at: z.string(),
      age: z.number().int(),
      unit: z.string().nullable(),
      quantity: decimal,
      allocated: decimal,
      available: decimal,
      unit_cost: decimal,
      currency: z.string(),
    })
    .nullable(),
})
export function comparisonParams(raw: RawSearchParams) {
  const first = (key: string) => (Array.isArray(raw[key]) ? raw[key][0] : raw[key])
  return z
    .object({
      day: z.iso.date(),
      basis: z.enum(['calculated', 'approved']),
      override: z.uuid().optional(),
    })
    .refine((v) => (v.basis === 'approved') === (v.override !== undefined))
    .safeParse({
      day: first('day'),
      basis: first('basis'),
      override: first('override') || undefined,
    })
}
