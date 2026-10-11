import { z } from 'zod'
import { formValuesFromRow } from '../form-values'
import { isUuid } from '../list-params'
import { dateSchema, nameArSchema, nameEnSchema, noteSchema } from '../schemas'
import { defineEntity, type FieldDef } from '../types'

/**
 * Per-organization calendar exceptions for one country (every location and supplier without its
 * own calendar there) or one work calendar: `closure` adds non-working days, `working_day` cancels
 * a public holiday or weekend day. Date ranges of one scope never overlap
 * (holiday_overrides_no_overlap). Precedence: calendar > country > public holidays > weekly pattern.
 */

export const HOLIDAY_KINDS = ['closure', 'working_day'] as const
/** ends_on - starts_on < 366 (holiday_overrides_range_check): at most 366 days, both included. */
export const MAX_RANGE_DAYS = 366

export type HolidayScope = { country_code: string | null; work_calendar_id: string | null }

/**
 * The scope select's value (`country:SA` or `calendar:<uuid>`, the same text as the generated
 * `scope_key` column) as the two scope columns, or null when malformed.
 */
export function parseHolidayScope(value: string): HolidayScope | null {
  const separator = value.indexOf(':')
  if (separator < 0) return null
  const kind = value.slice(0, separator)
  const reference = value.slice(separator + 1)
  if (kind === 'country' && /^[A-Za-z]{2}$/.test(reference)) {
    return { country_code: reference.toUpperCase(), work_calendar_id: null }
  }
  if (kind === 'calendar' && isUuid(reference)) {
    return { country_code: null, work_calendar_id: reference.toLowerCase() }
  }
  return null
}

const SCOPE_PATTERN =
  /^(?:country:[A-Z]{2}|calendar:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/

export const holidayScopeSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value, ctx) => {
    const scope = parseHolidayScope(value)
    if (scope) return scope
    ctx.addIssue({ code: 'custom', message: 'invalidChoice', params: { key: 'invalidChoice' } })
    return z.NEVER
  })

/** Whole days from `start` to `end` (YYYY-MM-DD, both valid dates). */
export function daysBetween(start: string, end: string): number {
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
  )
}

export const holidayOverrideSchema = z
  .object({
    scope: holidayScopeSchema,
    starts_on: dateSchema,
    ends_on: dateSchema,
    kind: z.enum(HOLIDAY_KINDS),
    name_en: nameEnSchema,
    name_ar: nameArSchema,
    note: noteSchema,
  })
  .superRefine((override, ctx) => {
    if (override.ends_on < override.starts_on) {
      ctx.addIssue({
        code: 'custom',
        message: 'endBeforeStart',
        path: ['ends_on'],
        params: { key: 'endBeforeStart' },
      })
    } else if (daysBetween(override.starts_on, override.ends_on) >= MAX_RANGE_DAYS) {
      ctx.addIssue({
        code: 'custom',
        message: 'rangeTooLong',
        path: ['ends_on'],
        params: { key: 'rangeTooLong', values: { max: MAX_RANGE_DAYS } },
      })
    }
  })

export type HolidayOverrideInput = z.output<typeof holidayOverrideSchema>

const fields: readonly FieldDef[] = [
  {
    name: 'scope',
    kind: 'select',
    required: true,
    options: { source: 'holiday_scopes' },
    hint: true,
    wide: true,
  },
  { name: 'starts_on', kind: 'date', required: true },
  { name: 'ends_on', kind: 'date', required: true, hint: true },
  {
    name: 'kind',
    kind: 'select',
    required: true,
    options: { source: 'enum', values: HOLIDAY_KINDS },
    hint: true,
  },
  { name: 'name_en', kind: 'text', required: true, maxLength: 200 },
  { name: 'name_ar', kind: 'nameAr', maxLength: 200 },
  { name: 'note', kind: 'textarea', maxLength: 1000 },
]

export const holidayOverrides = defineEntity({
  key: 'holidayOverrides',
  table: 'holiday_overrides',
  namespace: 'HolidayOverrides',
  area: 'locations',
  tab: 'holidays',
  basePath: '/locations/holidays',
  listSelect:
    'id, name_en, name_ar, starts_on, ends_on, kind, country_code, ...countries!holiday_overrides_country_code_fkey(country_name:name_en), calendar:work_calendars!holiday_overrides_calendar_fkey(code, name_en)',
  editSelect: 'id, scope_key, starts_on, ends_on, kind, name_en, name_ar, note, updated_at',
  list: {
    // Index: holiday_overrides_starts_idx (starts_on); the scope filter uses
    // holiday_overrides_scope_start_key (scope_key, starts_on).
    sorts: ['starts_on'],
    defaultSort: 'starts_on',
    defaultDir: 'desc',
    tiebreak: 'id',
    filters: [
      { param: 'scope', column: 'scope_key', kind: 'pattern', pattern: SCOPE_PATTERN },
      { param: 'kind', column: 'kind', kind: 'enum', values: HOLIDAY_KINDS },
    ],
    search: false,
  },
  filterOptions: { scope: 'holiday_scopes' },
  // One "scope" cell: the country's name or the calendar's code.
  enrichRows: (rows) =>
    rows.map((row) => ({
      ...row,
      scope_label:
        (row.country_name as string | null | undefined) ??
        (row.calendar as { code?: string } | null | undefined)?.code ??
        null,
    })),
  columns: [
    { key: 'name', kind: 'name', link: true },
    { key: 'scope', kind: 'text', field: 'scope_label' },
    { key: 'starts_on', kind: 'date', sortable: true },
    { key: 'ends_on', kind: 'date' },
    { key: 'kind', kind: 'badge' },
  ],
  fields,
  schema: holidayOverrideSchema,
  toRow: ({ scope, ...override }) => ({ ok: true, row: { ...override, ...scope } }),
  toForm: (row) => ({ ...formValuesFromRow(fields, row), scope: String(row.scope_key ?? '') }),
  defaults: ({ organization }) => ({
    scope: `country:${organization.home_country}`,
    kind: 'closure',
  }),
  titleOf: (row) =>
    row.starts_on === row.ends_on
      ? String(row.starts_on ?? '')
      : `${String(row.starts_on ?? '')} – ${String(row.ends_on ?? '')}`,
  constraintFields: {
    holiday_overrides_no_overlap: 'starts_on',
    holiday_overrides_scope_start_key: 'starts_on',
    holiday_overrides_range_check: 'ends_on',
    holiday_overrides_one_scope: 'scope',
    holiday_overrides_calendar_fkey: 'scope',
    holiday_overrides_country_code_fkey: 'scope',
  },
})
