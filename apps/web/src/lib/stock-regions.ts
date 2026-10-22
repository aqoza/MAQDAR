import { z } from 'zod'
import { codeSchema } from './master-data/schemas'

export const STOCK_REGION_INPUT_BYTES = 8192
export const stockRegionsPath = '/replenishment/regional-stock/regions'
export const locationSetSchema = z
  .array(codeSchema())
  .min(2)
  .max(20)
  .refine((codes) => new Set(codes).size === codes.length)
  .transform((codes) => [...codes].sort())
export const stockRegionInputSchema = z.object({
  name_en: z.string().trim().min(1).max(200),
  name_ar: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((name) => name || null),
  location_codes: locationSetSchema,
  confirmed: z.literal(true),
})
export const stockRegionReportSchema = z.object({
  method: z.literal('stock-region-v1'),
  input: stockRegionInputSchema,
  locations: z
    .array(
      z.object({
        id: z.guid(),
        code: z.string(),
        name_en: z.string(),
        name_ar: z.string().nullable(),
        location_type: z.string(),
        updated_at: z.string(),
      }),
    )
    .min(2)
    .max(20),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export const capturedStockRegionSchema = z.object({
  id: z.guid(),
  name_en: z.string(),
  name_ar: z.string().nullable(),
  created_at: z.string(),
  definition: stockRegionReportSchema,
})
export type StockRegionInput = z.infer<typeof stockRegionInputSchema>
export type StockRegionReport = z.infer<typeof stockRegionReportSchema>
