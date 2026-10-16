import { z } from 'zod'
import type { RawSearchParams } from './master-data/list-params'

export const purchaseCostStatuses = [
  'available',
  'no_order_needed',
  'source_unavailable',
  'supplier_unavailable',
  'terms_missing',
  'unit_unknown',
  'unit_mismatch',
  'price_invalid',
  'price_date_unknown',
  'price_not_effective',
  'price_unconfirmed',
  'amount_out_of_range',
] as const
export const purchaseCostInputSchema = z.object({
  delivery: z.uuid(),
  confirmed: z.enum(['true', 'false']),
})
export const purchaseCostSaveSchema = purchaseCostInputSchema.extend({
  request_id: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export function purchaseCostParams(raw: RawSearchParams) {
  const first = (key: string) => (Array.isArray(raw[key]) ? raw[key][0] : raw[key])
  return { delivery: first('delivery'), confirmed: first('confirmed') ?? 'false' }
}
const decimal = z.string().regex(/^\d+(\.\d+)?$/)
const date = z.iso.date()
export const purchaseCostReportSchema = z.object({
  method: z.literal('purchase-cost-v1'),
  status: z.enum(purchaseCostStatuses),
  location_id: z.uuid(),
  price_confirmed: z.boolean(),
  source: z.object({
    delivery_id: z.uuid(),
    delivery_fingerprint: z.string(),
    supplier_scenario_id: z.uuid(),
    supplier_fingerprint: z.string(),
    draft_id: z.uuid(),
    item_id: z.uuid().nullable(),
    item_code: z.string(),
    location_code: z.string(),
    supplier_id: z.uuid().nullable(),
    supplier_code: z.string(),
    unit: z.string().nullable(),
    quantity: decimal.nullable(),
    cutoff: date,
    order_date: date.nullable(),
    receipt_date: date.nullable(),
    policy_recalculation_required: z.boolean().nullable(),
  }),
  supplier: z
    .object({
      id: z.uuid(),
      code: z.string(),
      active: z.boolean(),
      updated_at: z.string(),
    })
    .nullable(),
  price: z
    .object({
      terms_id: z.uuid(),
      item_id: z.uuid(),
      supplier_id: z.uuid(),
      unit: z.string().nullable(),
      unit_price: decimal.nullable(),
      raw_unit_price: z.string(),
      currency: z.string().regex(/^[A-Z]{3}$/),
      minor_units: z.number().int().min(0).max(3).nullable(),
      valid_from: z.string().nullable(),
      updated_at: z.string(),
    })
    .nullable(),
  exact_product: decimal.nullable(),
  subtotal: decimal.nullable(),
  rounding: z.literal('half-up-currency-minor-units'),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export type PurchaseCostReport = z.infer<typeof purchaseCostReportSchema>

/** Modern Intl accepts decimal strings without the precision loss of Number(value). */
export function formatCostDecimal(value: string | null, locale: string, digits = 6) {
  if (value === null) return '—'
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(
    value as unknown as number,
  )
}
export function formatPurchaseCost(
  value: string | null,
  currency: string | null,
  digits: number | null,
  locale: string,
) {
  if (value === null || currency === null || digits === null) return '—'
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value as unknown as number)
}
