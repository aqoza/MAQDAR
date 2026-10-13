import { z } from 'zod'
import { codeSchema, nameArSchema, nameEnSchema, optionalCountryCodeSchema } from '../schemas'
import { defineEntity } from '../types'

/**
 * Working-day calendars: weekend days as ISO weekdays (1 = Monday … 7 = Sunday) and, when
 * observe_public_holidays, the public holidays of country_code. Locations and suppliers without a
 * calendar use their country's default (countries.weekend_days and public_holidays).
 */

export const ISO_WEEKDAYS = ['1', '2', '3', '4', '5', '6', '7'] as const
/** At least one working day remains (work_calendars_weekend_days_check). */
export const MAX_WEEKEND_DAYS = 6

/** Ticked weekday checkboxes (repeated form values) → distinct ISO weekday numbers, ascending. */
export const weekendDaysSchema = z
  .array(z.string().trim())
  .transform((days) => [...new Set(days)])
  .pipe(z.array(z.enum(ISO_WEEKDAYS)).max(MAX_WEEKEND_DAYS))
  .transform((days) => days.map(Number).sort((a, b) => a - b))

export const workCalendarSchema = z
  .object({
    code: codeSchema(),
    name_en: nameEnSchema,
    name_ar: nameArSchema,
    country_code: optionalCountryCodeSchema,
    weekend_days: weekendDaysSchema,
    observe_public_holidays: z.boolean(),
    is_active: z.boolean(),
  })
  .refine((calendar) => calendar.country_code !== null || !calendar.observe_public_holidays, {
    path: ['country_code'],
    params: { key: 'countryRequired' },
  })

export type WorkCalendarInput = z.output<typeof workCalendarSchema>

export const workCalendars = defineEntity({
  key: 'workCalendars',
  table: 'work_calendars',
  namespace: 'WorkCalendars',
  area: 'locations',
  tab: 'calendars',
  basePath: '/locations/calendars',
  importEntity: 'work_calendars',
  listSelect:
    'id, code, name_en, name_ar, country_code, weekend_days, observe_public_holidays, is_active',
  editSelect:
    'id, code, name_en, name_ar, country_code, weekend_days, observe_public_holidays, is_active, updated_at',
  list: {
    // Indexes: work_calendars_organization_id_code_key, work_calendars_name_idx (name_en, code).
    sorts: ['code', 'name_en'],
    defaultSort: 'code',
    defaultDir: 'asc',
    tiebreak: 'code',
    filters: [
      { param: 'country', column: 'country_code', kind: 'pattern', pattern: /^[A-Z]{2}$/ },
      { param: 'active', column: 'is_active', kind: 'boolean' },
    ],
    search: true,
  },
  filterOptions: { country: 'countries' },
  columns: [
    { key: 'code', kind: 'code', sortable: true, link: true },
    { key: 'name', kind: 'name', sortable: true, sortBy: 'name_en' },
    { key: 'country_code', kind: 'code' },
    { key: 'weekend_days', kind: 'weekdays' },
    { key: 'observe_public_holidays', kind: 'boolean' },
    { key: 'is_active', kind: 'boolean' },
  ],
  fields: [
    { name: 'code', kind: 'code', required: true, maxLength: 64, hint: true },
    { name: 'country_code', kind: 'select', options: { source: 'countries' }, hint: true },
    { name: 'name_en', kind: 'text', required: true, maxLength: 200 },
    { name: 'name_ar', kind: 'nameAr', maxLength: 200 },
    { name: 'weekend_days', kind: 'weekdays', hint: true },
    { name: 'observe_public_holidays', kind: 'switch', hint: true },
    { name: 'is_active', kind: 'switch', hint: true },
  ],
  schema: workCalendarSchema,
  toRow: (input) => ({ ok: true, row: { ...input } }),
  defaults: ({ organization }) => ({
    country_code: organization.home_country,
    observe_public_holidays: true,
    is_active: true,
  }),
  titleOf: (row) => String(row.code ?? ''),
  constraintFields: {
    work_calendars_holidays_need_country: 'country_code',
  },
})
