import { z } from 'zod'

const decimal = z.string().regex(/^\d+(\.\d+)?$/)
export const dashboardSchema = z.object({
  day: z.string(),
  observed_pairs: z.number().int().nonnegative(),
  unobserved_pairs: z.number().int().nonnegative(),
  stock_outs: z.number().int().nonnegative(),
  stale_pairs: z.number().int().nonnegative(),
  oldest_snapshot: z.string().nullable(),
  inventory_value: z.array(z.object({ currency: z.string().length(3), value: decimal })),
  demand: z.array(z.object({ date: z.string(), quantity: decimal, lost_sales_quantity: decimal })),
})
export type DashboardData = z.infer<typeof dashboardSchema>

/** Intl accepts decimal strings without a lossy Number conversion (ECMA-402); TS still types numbers only. */
export function formatInventoryValue(value: string, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(value as unknown as number)
}

/** Business day in the organization's configured zone, independent of the Worker's UTC day. */
export function reportingDay(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  return ['year', 'month', 'day']
    .map((key) => parts.find((part) => part.type === key)?.value)
    .join('-')
}
