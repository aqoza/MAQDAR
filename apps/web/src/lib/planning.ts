import { z } from 'zod'

export const planningRequestSchema = z
  .object({
    location_code: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
    from_date: z.iso.date(),
    to_date: z.iso.date(),
    request_id: z.uuid(),
  })
  .refine((value) => {
    const days = (Date.parse(value.to_date) - Date.parse(value.from_date)) / 86_400_000
    return days >= 0 && days <= 1095
  })

export const readinessSchema = z.object({
  version: z.literal(1),
  computed_at: z.iso.datetime({ offset: true }),
  active_items: z.number().int().nonnegative(),
  items_with_history: z.number().int().nonnegative(),
  stored_rows: z.number().int().nonnegative(),
  days_with_records: z.number().int().nonnegative(),
  positive_demand_rows: z.number().int().nonnegative(),
  first_record: z.iso.date().nullable(),
  last_record: z.iso.date().nullable(),
  quantity: z.string().regex(/^\d+(\.\d+)?$/),
  lost_sales_quantity: z.string().regex(/^\d+(\.\d+)?$/),
})

export function isActiveRun(status: string): boolean {
  return status === 'queued' || status === 'running'
}
