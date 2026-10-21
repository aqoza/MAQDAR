import { z } from 'zod'
import { installedDemandReportSchema } from './installed-base-demand'

export const EVALUATION_INPUT_BYTES = 4096
export const installedEvaluationInputSchema = z.object({
  scenario_id: z.guid().transform((id) => id.toLowerCase()),
  evaluation_name: z.string().trim().min(1).max(200),
  confirmed: z.literal(true),
})
// Exact quantities/squared sums and rounded means remain decimal strings in the UI.
const nonnegative = z.string().regex(/^\d{1,90}(\.\d{1,24})?$/)
const signed = z.string().regex(/^-?\d{1,90}(\.\d{1,24})?$/)
export const installedEvaluationReportSchema = z.object({
  method: z.literal('installed-base-evaluation-v1'),
  input: installedEvaluationInputSchema,
  unit: z.enum(['EA', 'SET', 'L', 'KG']),
  start_date: z.iso.date(),
  end_date: z.iso.date(),
  day_count: z.number().int().min(1).max(90),
  recorded_days: z.number().int().min(0).max(90),
  zero_filled_days: z.number().int().min(0).max(90),
  totals: z.object({
    expected: nonnegative,
    sold: nonnegative,
    lost_sales: nonnegative,
    difference: signed,
    absolute_error: nonnegative,
    squared_error: nonnegative,
  }),
  metrics: z.object({ mae: nonnegative, rmse: nonnegative, bias: signed }),
  days: z
    .array(
      z.object({
        date: z.iso.date(),
        expected_demand: nonnegative,
        recorded: z.boolean(),
        sold: nonnegative,
        lost_sales: nonnegative,
        supplied_unit: z.string().nullable(),
        difference: signed,
      }),
    )
    .min(1)
    .max(90),
  source: z.object({
    scenario_id: z.guid(),
    scenario_saved_at: z.string().min(1),
    scenario: installedDemandReportSchema,
  }),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export type InstalledEvaluationInput = z.infer<typeof installedEvaluationInputSchema>
export type InstalledEvaluationReport = z.infer<typeof installedEvaluationReportSchema>
