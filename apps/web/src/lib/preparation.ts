import { z } from 'zod'

const decimal = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/)
  .nullable()
export const preparationOptionsSchema = z.object({
  item_codes: z
    .string()
    .max(1625)
    .transform((value) =>
      value
        .split(/\r?\n/)
        .map((code) => code.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().min(1).max(64)).min(1).max(25))
    .refine((codes) => new Set(codes).size === codes.length),
})
export const preparationSummarySchema = z.object({
  target_code: z.string().nullable(),
  unit: z.string().nullable(),
  sold: decimal,
  lost: decimal,
  source_count: z.number().int(),
  issue: z
    .enum(['unit_mismatch', 'invalid_factor', 'conflicting_conversion', 'relationship_cycle'])
    .nullable(),
})
export const preparationOutputSchema = z.object({
  contributors: z.array(
    z.object({
      item_id: z.guid(),
      item_code: z.string(),
      factor: decimal,
      sold: decimal,
      lost: decimal,
      converted_sold: decimal,
      converted_lost: decimal,
    }),
  ),
  daily: z.array(
    z.object({
      date: z.iso.date(),
      sold: decimal,
      lost: decimal,
      active_sources: z.number().int(),
      working: z.boolean().nullable(),
      weekend: z.boolean(),
      holiday: z.boolean().nullable(),
      ramadan: z.boolean().nullable(),
      eid_al_fitr: z.boolean().nullable(),
      arafat_day: z.boolean().nullable(),
      eid_al_adha: z.boolean().nullable(),
      calendar_verified: z.boolean(),
      calendar_reason: z.enum([
        'unknown_coverage',
        'inactive_calendar',
        'calendar_override',
        'country_override',
        'weekend',
        'weekly_pattern',
        'public_holiday',
      ]),
    }),
  ),
})
export const preparationCalendarSchema = z.object({
  country: z.string(),
  calendar_code: z.string().nullable(),
  coverage_from: z.string().nullable(),
  coverage_to: z.string().nullable(),
})
