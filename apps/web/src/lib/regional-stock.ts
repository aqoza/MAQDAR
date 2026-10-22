import { z } from 'zod'
import { codeSchema, dateSchema, ITEM_STATUSES, UNITS_OF_MEASURE } from './master-data/schemas'

export const REGIONAL_INPUT_BYTES = 8192
export const regionalStockPath = '/replenishment/regional-stock'
export const regionalStockInputSchema = z.object({
  assessment_name: z.string().trim().min(1).max(200),
  item_code: codeSchema({ allowSlash: true }),
  unit: z.enum(UNITS_OF_MEASURE),
  as_of: dateSchema.refine((day) => day >= '0001-01-01'),
  location_codes: z
    .array(codeSchema())
    .min(2)
    .max(20)
    .refine((codes) => new Set(codes).size === codes.length)
    .transform((codes) => [...codes].sort()),
  confirmed: z.literal(true),
})
const quantity = z.string().regex(/^\d{1,18}(\.\d{1,3})?$/)
const signedQuantity = z.string().regex(/^-?\d{1,18}(\.\d{1,3})?$/)
const identity = z.object({
  code: z.string(),
  name_en: z.string(),
  name_ar: z.string().nullable(),
  updated_at: z.string(),
})
export const regionalStockReportSchema = z.object({
  method: z.literal('regional-stock-v1'),
  input: regionalStockInputSchema,
  status: z.enum(['available', 'unavailable']),
  item: identity.extend({
    id: z.guid(),
    status: z.enum(ITEM_STATUSES),
    catalog_unit: z.enum(UNITS_OF_MEASURE),
  }),
  lines: z
    .array(
      identity.extend({
        location_id: z.guid(),
        location_type: z.string(),
        is_active: z.boolean(),
        status: z.enum(['available', 'missing', 'stale', 'unit_unknown', 'unit_mismatch']),
        snapshot: z
          .object({
            id: z.guid(),
            date: z.iso.date(),
            age_days: z.number().int().nonnegative(),
            unit: z.enum(UNITS_OF_MEASURE).nullable(),
            on_hand: quantity,
            allocated: quantity,
            net: signedQuantity,
            updated_at: z.string(),
          })
          .nullable(),
      }),
    )
    .min(2)
    .max(20),
  totals: z.object({ on_hand: quantity, allocated: quantity, net: signedQuantity }).nullable(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export type RegionalStockInput = z.infer<typeof regionalStockInputSchema>
export type RegionalStockReport = z.infer<typeof regionalStockReportSchema>
