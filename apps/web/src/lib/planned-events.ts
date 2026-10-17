import { z } from 'zod'
import { normalizeDigits } from './master-data/numbers'
import { forecastEvidenceSchema, forecastSummarySchema } from './forecasting'

export const eventTypes = ['campaign', 'recall', 'tender'] as const
export const eventQuantitySchema = z
  .string()
  .max(40)
  .transform(normalizeDigits)
  .refine((value) => /^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,3})?$/.test(value))
  .transform((value) => {
    const [integer, fraction = ''] = value.replaceAll(',', '').split('.')
    const tail = fraction.replace(/0+$/, '')
    return `${integer.replace(/^0+(?=\d)/, '')}${tail ? `.${tail}` : ''}`
  })
  .pipe(z.string().regex(/^\d{1,15}(\.\d{1,3})?$/))
const quantity = eventQuantitySchema
export const eventInputSchema = z.object({
  forecast_id: z.uuid(),
  event_type: z.enum(eventTypes),
  name: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(2000),
  unit: z.enum(['EA', 'SET', 'L', 'KG']),
  confirmed: z.boolean(),
  additions: z
    .array(z.object({ date: z.iso.date(), quantity }))
    .min(1)
    .max(90)
    .refine((rows) => new Set(rows.map((row) => row.date)).size === rows.length)
    .transform((rows) => [...rows].sort((a, b) => a.date.localeCompare(b.date))),
})
export const eventSaveSchema = eventInputSchema.extend({
  request_id: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export const eventSourceStatuses = [
  'available',
  'forecast_unavailable',
  'prepared_group',
  'unit_unknown',
  'source_invalid',
] as const
export const eventSourceSchema = z.object({
  status: z.enum(eventSourceStatuses),
  forecast_id: z.uuid(),
  run_id: z.uuid(),
  location_id: z.uuid(),
  location_code: z.string(),
  item_id: z.uuid(),
  item_code: z.string(),
  item_name: z.string(),
  unit: z.string().nullable(),
  cutoff: z.iso.date(),
  model: z.string().nullable(),
  method: z.string().nullable(),
  summary: forecastSummarySchema,
  evidence: forecastEvidenceSchema,
})
const decimal = z.string().regex(/^\d+(\.\d+)?$/)
export const eventReportSchema = z.object({
  method: z.literal('planned-event-v1'),
  source: eventSourceSchema,
  input: eventInputSchema.omit({ forecast_id: true }),
  daily: z
    .array(
      z.object({ date: z.iso.date(), baseline: decimal, addition: decimal, adjusted: decimal }),
    )
    .min(1)
    .max(90),
  totals: z.object({ baseline: decimal, addition: decimal, adjusted: decimal }),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export type EventInput = z.output<typeof eventInputSchema>
export type EventSource = z.infer<typeof eventSourceSchema>
export type EventReport = z.infer<typeof eventReportSchema>

/** Dates/quantities stay paired; duplicates and malformed JSON fail before reaching the RPC. */
export function eventFormValues(form: FormData) {
  let additions: unknown
  try {
    additions = JSON.parse(String(form.get('additions') ?? ''))
  } catch {
    additions = null
  }
  return {
    forecast_id: form.get('forecast_id'),
    event_type: form.get('event_type'),
    name: form.get('name'),
    reason: form.get('reason'),
    unit: form.get('unit'),
    confirmed: form.get('confirmed') === 'true',
    additions,
    request_id: form.get('request_id'),
    fingerprint: form.get('fingerprint'),
  }
}
