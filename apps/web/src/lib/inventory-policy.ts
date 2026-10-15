import { z } from 'zod'

const integer = z
  .string()
  .regex(/^\d{1,2}$/)
  .transform(Number)
export const policyRequestSchema = z
  .object({
    forecast_id: z.uuid(),
    request_id: z.uuid(),
    lead_time: integer.pipe(z.number().int().min(0).max(89)),
    review_interval: integer.pipe(z.number().int().min(1).max(90)),
    service_percent: z
      .string()
      .regex(/^\d{2}(\.\d)?$/)
      .transform(Number)
      .pipe(z.number().min(50).max(99.9)),
  })
  .refine((v) => v.lead_time + v.review_interval <= 90)

const decimal = z.string().regex(/^-?\d+(\.\d+)?$/)
const period = z.object({
  days: z.number().int(),
  forecast: decimal,
  quantile: decimal,
  target: decimal,
  safety_stock: decimal,
})
export const POLICY_STATUSES = [
  'available',
  'insufficient_residuals',
  'no_positive_history',
  'unsupported_scale',
  'calibration_failed',
] as const
export const policyEvidenceSchema = z.object({
  method: z.literal('policy-v1'),
  options: z.object({
    lead_time: z.number().int(),
    review_interval: z.number().int(),
    service_level: decimal,
  }),
  forecast: z.object({
    id: z.uuid(),
    run_id: z.uuid(),
    item_id: z.uuid(),
    method: z.enum(['baseline-v1', 'expanded-v1', 'regional-v1']),
    to_date: z.iso.date(),
    horizon: z.number().int(),
    output: z.object({
      model: z.string(),
      forecast: z.array(z.object({ date: z.iso.date(), quantity: decimal })),
    }),
  }),
  output: z.object({
    status: z.enum(POLICY_STATUSES),
    lead_time: period.nullable(),
    protection: period.nullable(),
    residual_count: z.number().int(),
    positive_days: z.number().int(),
    samples: z.number().int(),
    seed: z.string(),
    calibration: z.array(
      z.object({
        date: z.iso.date(),
        train_to: z.iso.date(),
        actual: decimal,
        prediction: decimal,
        error: decimal,
      }),
    ),
  }),
})
