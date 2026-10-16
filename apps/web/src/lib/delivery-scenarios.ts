import { z } from 'zod'
import type { RawSearchParams } from './master-data/list-params'

export const deliveryScenarioStatuses = [
  'available',
  'no_order_needed',
  'source_unavailable',
  'supplier_unavailable',
  'location_unavailable',
  'calendars_unconfirmed',
  'calendar_unknown',
  'calendar_inactive',
  'search_exhausted',
] as const
const date = z.iso.date()
export const deliveryScenarioInputSchema = z.object({
  scenario: z.uuid(),
  requested: date.refine((v) => v >= '1900-01-01' && v <= '2100-12-31'),
  confirmed: z.enum(['true', 'false']),
})
export const deliveryScenarioSaveSchema = deliveryScenarioInputSchema.extend({
  request_id: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export function deliveryScenarioParams(raw: RawSearchParams) {
  const first = (key: string) => (Array.isArray(raw[key]) ? raw[key][0] : raw[key])
  return {
    scenario: first('scenario'),
    requested: first('requested'),
    confirmed: first('confirmed') ?? 'false',
  }
}
const calendar = z.object({
  country: z.string(),
  calendar_id: z.uuid().nullable(),
  calendar_code: z.string().nullable(),
  calendar_updated_at: z.string().nullable(),
  active: z.boolean(),
  weekend_days: z
    .array(
      z.union([
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(4),
        z.literal(5),
        z.literal(6),
        z.literal(7),
      ]),
    )
    .nullable(),
  observe_public_holidays: z.boolean(),
  coverage_from: date.nullable(),
  coverage_to: date.nullable(),
  holidays: z.array(z.object({ date, sector: z.string(), name: z.string(), source: z.string() })),
  overrides: z.array(
    z.object({
      id: z.uuid(),
      calendar_id: z.uuid().nullable(),
      starts_on: date,
      ends_on: date,
      kind: z.enum(['closure', 'working_day']),
      name: z.string(),
      updated_at: z.string(),
    }),
  ),
})
export const calendarReasons = [
  'unknown_coverage',
  'inactive_calendar',
  'calendar_override',
  'country_override',
  'public_holiday',
  'weekend',
  'weekly_pattern',
] as const
const search = z.object({
  status: z.enum(['resolved', 'calendar_unknown', 'calendar_inactive', 'search_exhausted']),
  date: date.nullable(),
  days: z
    .array(
      z.object({
        date,
        working: z.boolean().nullable(),
        reason: z.enum(calendarReasons),
        weekend: z.boolean(),
        holiday: z.boolean().nullable(),
        verified: z.boolean(),
        override_id: z.uuid().nullable(),
      }),
    )
    .max(90),
})
const entity = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  active: z.boolean(),
  updated_at: z.string(),
})
export const deliveryScenarioReportSchema = z.object({
  method: z.literal('delivery-dates-v1'),
  status: z.enum(deliveryScenarioStatuses),
  location_id: z.uuid(),
  requested_date: date,
  calendars_confirmed: z.boolean(),
  blocked_stage: z.enum(['supplier', 'receiver']).nullable(),
  source: z.object({
    scenario_id: z.uuid(),
    fingerprint: z.string(),
    draft_id: z.uuid(),
    item_code: z.string(),
    location_code: z.string(),
    supplier_code: z.string(),
    unit: z.string().nullable(),
    quantity: z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .nullable(),
    lead_time: z.number().int().nonnegative().nullable(),
    cutoff: date,
  }),
  supplier: entity.nullable(),
  receiver: entity.nullable(),
  supplier_calendar: calendar.nullable(),
  receiver_calendar: calendar.nullable(),
  order_search: search.nullable(),
  receipt_search: search.nullable(),
  order_date: date.nullable(),
  nominal_receipt: date.nullable(),
  receipt_date: date.nullable(),
  expected_receipt: date.nullable(),
  elapsed_days: z.number().int().nonnegative().nullable(),
  policy_recalculation_required: z.boolean().nullable(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export type DeliveryScenarioReport = z.infer<typeof deliveryScenarioReportSchema>
