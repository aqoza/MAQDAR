import { z } from 'zod'
import { firstParam, type RawSearchParams } from './master-data/list-params'

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

export const kpiSchema = dashboardSchema.extend({
  location_code: z.string().nullable(),
  available_pairs: z.number().int().nonnegative(),
})

export function dashboardParams(raw: RawSearchParams, today: string) {
  const candidate = firstParam(raw.day)
  const day =
    candidate &&
    z.iso.date().safeParse(candidate).success &&
    candidate >= '0001-01-01' &&
    candidate <= today
      ? candidate
      : today
  const code = firstParam(raw.location)?.trim()
  const location = code && /^[A-Za-z0-9_.-]{1,64}$/.test(code) ? code : null
  return { day, location }
}

export function availability(available: number, observed: number): number | null {
  return observed === 0 ? null : available / observed
}

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
