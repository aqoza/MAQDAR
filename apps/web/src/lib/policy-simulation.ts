import { z } from 'zod'

export const simulationRequestSchema = z.object({
  policy_id: z.guid(),
  request_id: z.uuid(),
  to_date: z.iso.date(),
  opening_stock: z.string().regex(/^\d{1,15}(\.\d{1,3})?$/),
  alternative_maximum: z.string().regex(/^\d{1,15}(\.\d{1,3})?$/),
  history_confirmed: z.literal('on'),
  empty_start_confirmed: z.literal('on'),
})

const decimal = z.string().regex(/^\d{1,35}(\.\d{1,6})?$/)
export const simulationMetrics = z.object({
  days: z.number().int().min(1).max(90),
  order_count: z.number().int().min(0).max(90),
  backlog_days: z.number().int().min(0).max(90),
  sold_quantity: decimal,
  lost_sales_quantity: decimal,
  ordered_quantity: decimal,
  received_quantity: decimal,
  immediate_fulfilled: decimal,
  closing_stock_sum: decimal,
  average_closing_stock: decimal,
  immediate_fill_rate: decimal.nullable(),
  ending_stock: decimal,
  ending_backlog: decimal,
  ending_on_order: decimal,
})
export const simulationEvidenceSchema = z.object({
  method: z.literal('periodic-replay-v1'),
  computed_at: z.iso.datetime({ offset: true }),
  from_date: z.iso.date(),
  to_date: z.iso.date(),
  options: z.object({
    opening_stock: decimal,
    alternative_maximum: decimal,
    history_confirmed: z.literal(true),
    empty_start_confirmed: z.literal(true),
  }),
  policy: z.object({
    id: z.guid(),
    run_id: z.guid(),
    item_id: z.guid(),
    item_code: z.string(),
    unit: z.string().min(1),
    cutoff: z.iso.date(),
    horizon: z.number().int().min(1).max(90),
    lead_time: z.number().int().min(0).max(89),
    review_interval: z.number().int().min(1).max(90),
    maximum: decimal,
  }),
  demand: z
    .array(
      z.object({
        date: z.iso.date(),
        quantity: decimal,
        lost_sales_quantity: decimal,
        recorded: z.boolean(),
      }),
    )
    .min(1)
    .max(90),
  output: z.object({
    method: z.literal('periodic-replay-v1'),
    variants: z
      .array(
        z.object({
          name: z.enum(['baseline', 'alternative']),
          maximum: decimal,
          metrics: simulationMetrics,
          ledger: z
            .array(
              z.object({
                date: z.iso.date(),
                review: z.boolean(),
                order_due: z.iso.date().nullable(),
                demand: decimal,
                lost_sales: decimal,
                opening_stock: decimal,
                receipts: decimal,
                backlog_fulfilled: decimal,
                order_quantity: decimal,
                immediate_fulfilled: decimal,
                new_backlog: decimal,
                closing_stock: decimal,
                closing_backlog: decimal,
                closing_on_order: decimal,
              }),
            )
            .min(1)
            .max(90),
        }),
      )
      .length(2),
  }),
})

export type SimulationEvidence = z.infer<typeof simulationEvidenceSchema>

export function simulationEnd(cutoff: string, horizon: number, today: string) {
  const first = new Date(Date.parse(cutoff) + 86_400_000).toISOString().slice(0, 10)
  const last = new Date(
    Math.min(Date.parse(cutoff) + horizon * 86_400_000, Date.parse(today) - 86_400_000),
  )
    .toISOString()
    .slice(0, 10)
  return { first, last, available: first <= last }
}
