import { z } from 'zod'
import { driverReportSchema } from './external-drivers'

export const driverForecastRequest = z.object({
  forecast_id: z.guid(),
  dataset_id: z.guid(),
  request_id: z.uuid(),
})
export const driverCheckSchema = z.object({
  cutoff: z.iso.date(),
  stage: z.enum(['selection', 'final']),
  status: z.enum(['available', 'unavailable']),
  reason: z.enum(['driver_missing', 'driver_late', 'driver_constant']).optional(),
  date: z.iso.date().nullable().optional(),
  phase: z.enum(['training', 'prediction']).nullable().optional(),
})
const decimal = z.string().regex(/^-?\d+(\.\d+)?$/)
export const driverModelSchema = z.object({
  status: z.enum(['available', 'unavailable']),
  penalty: decimal.optional(),
  center: decimal.optional(),
  scale: decimal.optional(),
  slope: decimal.optional(),
  weekday_intercepts: z.array(decimal).length(7).optional(),
  training_min: decimal.optional(),
  training_max: decimal.optional(),
  extrapolated_dates: z.array(z.iso.date()).optional(),
})
export const capturedDriverSchema = z.object({
  id: z.guid(),
  imported_at: z.string(),
  report: driverReportSchema,
})

export const multiDriverForecastRequest = driverForecastRequest.omit({ dataset_id: true }).extend({
  dataset_ids: z
    .array(z.guid())
    .min(2)
    .max(5)
    .refine((ids) => new Set(ids).size === ids.length),
})
export const multiDriverPredictorSchema = driverModelSchema
  .pick({
    center: true,
    scale: true,
    slope: true,
    training_min: true,
    training_max: true,
    extrapolated_dates: true,
  })
  .required()
  .extend({ dataset_id: z.guid() })
