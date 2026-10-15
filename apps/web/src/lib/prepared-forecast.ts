import { z } from 'zod'

export const preparedForecastSchema = z.object({
  preparation_id: z.uuid(),
  request_id: z.uuid(),
  horizon: z
    .string()
    .regex(/^\d{1,2}$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(90)),
})

const decimal = z.string().regex(/^-?\d+(\.\d+)?$/)
export const calendarModelSchema = z.object({
  method: z.literal('weekday-event-shrinkage-v1'),
  unknown_training_days: z.number().int(),
  unknown_future_days: z.number().int(),
  effects: z.array(
    z.object({
      event: z.enum(['holiday', 'ramadan']),
      days: z.number().int(),
      ordinary_days: z.number().int(),
      status: z.enum(['available', 'insufficient_support']),
      adjustment: decimal,
    }),
  ),
  weekdays: z.array(
    z.object({ day: z.literal([1, 2, 3, 4, 5, 6, 7]), days: z.number().int(), mean: decimal }),
  ),
})
export const preparedSourceSchema = z.object({
  id: z.uuid(),
  run_id: z.uuid(),
  group_id: z.uuid(),
  unit: z.string(),
  original_from: z.string(),
  comparison: z.literal('fixed-group-v1'),
})
export const futureCalendarSchema = z.array(
  z.object({
    date: z.string(),
    holiday: z.boolean().nullable(),
    ramadan: z.boolean().nullable(),
    calendar_verified: z.boolean(),
    working: z.boolean().nullable(),
  }),
)
