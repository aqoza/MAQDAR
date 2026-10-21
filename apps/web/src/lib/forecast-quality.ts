import { z } from 'zod'
import {
  ALL_FORECAST_MODELS as FORECAST_MODELS,
  FORECAST_STATUSES,
  forecastReadEvidenceSchema as forecastEvidenceSchema,
} from './forecasting'
import { parseListParams, type RawSearchParams, type ListSpec } from './master-data/list-params'

export const FORECAST_METHODS = ['baseline-v1', 'expanded-v1', 'regional-v1', 'driver-v1'] as const
export const qualitySpec: ListSpec = {
  sorts: ['finished_at'],
  defaultSort: 'finished_at',
  defaultDir: 'desc',
  tiebreak: 'id',
  search: true,
  filters: [
    {
      param: 'location',
      column: 'location_code',
      kind: 'pattern',
      pattern: /^[A-Za-z0-9_.-]{1,64}$/,
    },
    { param: 'status', column: 'status', kind: 'enum', values: FORECAST_STATUSES },
    { param: 'model', column: 'model', kind: 'enum', values: FORECAST_MODELS },
    { param: 'method', column: 'method', kind: 'enum', values: FORECAST_METHODS },
  ],
}
export const qualityParams = (raw: RawSearchParams) => parseListParams(raw, qualitySpec)
const decimal = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/)
  .nullable()
export const qualityRowSchema = z.object({
  id: z.guid(),
  run_id: z.guid(),
  item_id: z.guid(),
  item_code: z.string(),
  item_name: z.string(),
  location_code: z.string(),
  status: z.enum(FORECAST_STATUSES),
  model: z.enum(FORECAST_MODELS).nullable(),
  from_date: z.iso.date(),
  to_date: z.iso.date(),
  finished_at: z.string(),
  method: z.enum(FORECAST_METHODS),
  horizon: z.string().regex(/^\d{1,2}$/),
  unit: z.string().nullable(),
  comparison: z.literal('fixed-group-v1').nullable(),
  rmse: decimal,
  mae: decimal,
  bias: decimal,
  folds: forecastEvidenceSchema.shape.output.shape.folds,
  evaluation: forecastEvidenceSchema.shape.output.shape.evaluation.unwrap(),
})

/** Runtime Intl decimal-string support preserves digits beyond binary Number precision. */
export function formatScore(value: string | null | undefined, locale: string): string {
  return value == null
    ? '—'
    : new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(value as unknown as number)
}
export function formatCoverage(value: string | undefined, locale: string): string {
  return value === undefined
    ? '—'
    : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(
        value as unknown as number,
      )
}
