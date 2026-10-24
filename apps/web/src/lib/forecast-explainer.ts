import { z } from 'zod'
import { ALL_FORECAST_MODELS } from './forecasting'
import { explanationRequestSchema } from './policy-explainer'
export const forecastEvidenceReferences = [
  'forecast_context',
  'model_comparison',
  'backtest_windows',
  'uncertainty',
  'held_out_coverage',
  'forecast_limits',
] as const
const decimal = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/)
  .max(100)
const model = z.enum(ALL_FORECAST_MODELS)
const date = z.iso.date()
export const forecastExplanationEvidenceSchema = z.strictObject({
  method: z.literal('forecast-explainer-v1'),
  unit: z.enum(['EA', 'SET', 'L', 'KG']),
  forecast_context: z.strictObject({
    method: z.enum(['baseline-v1', 'expanded-v1', 'driver-v1', 'multi-driver-v1']),
    from_date: date,
    cutoff: date,
    horizon_days: z.number().int().min(1).max(90),
    selected_model: model,
  }),
  model_comparison: z.strictObject({
    scores: z
      .array(z.strictObject({ model, rmse: decimal, mae: decimal, bias: decimal }))
      .min(1)
      .max(12),
    unavailable_models: z
      .array(
        z.strictObject({
          model,
          reason: z.enum([
            'fit_failed',
            'refit_failed',
            'driver_missing',
            'driver_late',
            'driver_constant',
          ]),
        }),
      )
      .max(12),
  }),
  backtest_windows: z.strictObject({
    windows: z
      .array(z.strictObject({ train_from: date, train_to: date, test_from: date, test_to: date }))
      .length(3),
  }),
  uncertainty: z.strictObject({
    status: z.enum(['available', 'unavailable', 'insufficient_residuals', 'not_recorded']),
    residual_count: z.number().int().nonnegative().nullable(),
  }),
  held_out_coverage: z.strictObject({
    status: z.enum([
      'available',
      'unavailable',
      'insufficient_history',
      'insufficient_residuals',
      'not_recorded',
    ]),
    model: model.nullable(),
    train_to: date.nullable(),
    test_from: date.nullable(),
    test_to: date.nullable(),
    count: z.number().int().nonnegative().nullable(),
    calibration: z.number().int().nonnegative().nullable(),
    coverage80: decimal.nullable(),
    coverage95: decimal.nullable(),
  }),
  forecast_limits: z.strictObject({
    driver_conditioned: z.boolean(),
    interpretation: z.string().min(1).max(700),
  }),
})
export const forecastExplanationPreviewSchema = z.strictObject({
  evidence: forecastExplanationEvidenceSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  forecast_id: z.guid(),
  forecast_run_id: z.guid(),
  item_id: z.guid(),
  location_id: z.guid(),
})
export const forecastExplanationRequestSchema = explanationRequestSchema
  .omit({ policy_id: true })
  .extend({ forecast_id: z.guid() })
export const forecastExplanationAnswerSchema = z.strictObject({
  paragraphs: z
    .array(
      z.strictObject({
        text: z.string().trim().min(1).max(2000),
        references: z.array(z.enum(forecastEvidenceReferences)).min(1).max(5),
      }),
    )
    .min(1)
    .max(8),
})
export type ForecastExplanationEvidence = z.infer<typeof forecastExplanationEvidenceSchema>
export type ForecastExplanationAnswer = z.infer<typeof forecastExplanationAnswerSchema>
