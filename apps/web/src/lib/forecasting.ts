import { z } from 'zod'

export const FORECAST_MODELS = [
  'mean',
  'naive',
  'seasonal_naive',
  'ses',
  'croston',
  'sba',
  'tsb',
] as const
export const FORECAST_STATUSES = ['selected', 'insufficient', 'outside_lifecycle'] as const
export const forecastOptionsSchema = z.object({
  horizon: z
    .string()
    .regex(/^\d{1,2}$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(90)),
  item_codes: z
    .string()
    .max(6500)
    .transform((value) =>
      value
        .split(/\r?\n/)
        .map((v) => v.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().min(1).max(64)).min(1).max(100))
    .refine((codes) => new Set(codes).size === codes.length),
})
const decimal = z.string().regex(/^-?\d+(\.\d+)?$/)
const accuracy = z.object({ rmse: decimal, mae: decimal, bias: decimal })
const score = accuracy.extend({ model: z.enum(FORECAST_MODELS), folds: z.array(accuracy) })
export const forecastSummarySchema = z.object({ total: decimal.nullable(), scores: z.array(score) })
export const forecastEvidenceSchema = z.object({
  source: z.object({
    start_day: z.string(),
    end_day: z.string(),
    introduced_on: z.string().nullable(),
    discontinued_on: z.string().nullable(),
    demand: z.array(z.tuple([z.string(), decimal, decimal])),
  }),
  output: forecastSummarySchema.extend({
    status: z.enum(FORECAST_STATUSES),
    model: z.enum(FORECAST_MODELS).nullable(),
    forecast: z.array(z.object({ date: z.string(), quantity: decimal })),
    folds: z.array(
      z.object({
        train_from: z.string(),
        train_to: z.string(),
        test_from: z.string(),
        test_to: z.string(),
      }),
    ),
  }),
})
