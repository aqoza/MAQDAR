import { z } from 'zod'
import type { RawSearchParams } from './master-data/list-params'

export const supplierScenarioStatuses = [
  'available',
  'draft_unavailable',
  'policy_unavailable',
  'supplier_missing',
  'supplier_inactive',
  'terms_missing',
  'unit_unknown',
  'unit_mismatch',
  'lead_time_mismatch',
  'terms_unconfirmed',
  'quantity_out_of_range',
] as const
const decimal = z.string().regex(/^-?\d+(\.\d+)?$/)
export const supplierScenarioInputSchema = z.object({
  draft: z.uuid(),
  supplier: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
  confirmed: z.enum(['true', 'false']),
})
export const supplierScenarioSaveSchema = supplierScenarioInputSchema.extend({
  request_id: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export function supplierScenarioParams(raw: RawSearchParams) {
  const first = (key: string) => (Array.isArray(raw[key]) ? raw[key][0] : raw[key])
  return {
    draft: first('draft'),
    supplier: first('supplier'),
    confirmed: first('confirmed') ?? 'false',
  }
}
export const supplierScenarioReportSchema = z.object({
  method: z.literal('supplier-rounding-v1'),
  status: z.enum(supplierScenarioStatuses),
  location_id: z.uuid(),
  requested_supplier_code: z.string(),
  terms_confirmed: z.boolean(),
  source: z.object({
    draft_id: z.uuid(),
    draft_fingerprint: z.string(),
    policy_id: z.uuid(),
    item_id: z.uuid(),
    item_code: z.string(),
    location_code: z.string(),
    cutoff: z.iso.date(),
    unit: z.string().nullable(),
    gap: decimal.nullable(),
    lead_time: z.number().int().nonnegative().nullable(),
  }),
  supplier: z
    .object({
      id: z.uuid(),
      code: z.string(),
      name: z.string(),
      active: z.boolean(),
      updated_at: z.string(),
    })
    .nullable(),
  terms: z
    .object({
      id: z.uuid(),
      unit: z.string().nullable(),
      moq: decimal,
      pack: decimal,
      lead_time: z.number().int().nonnegative(),
      updated_at: z.string(),
    })
    .nullable(),
  quantity: decimal.nullable(),
  overage: decimal.nullable(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export type SupplierScenarioReport = z.infer<typeof supplierScenarioReportSchema>
