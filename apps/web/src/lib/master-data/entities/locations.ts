import { z } from 'zod'
import { optionalDecimalSchema } from '../numbers'
import {
  codeSchema,
  countryCodeSchema,
  nameArSchema,
  nameEnSchema,
  optionalText,
  optionalUuidSchema,
} from '../schemas'
import { defineEntity, type EntityRow } from '../types'

/** Warehouses, regional hubs and branches. parent_location_id is the default replenishment source. */

export const LOCATION_TYPES = ['central', 'hub', 'branch'] as const
export const CITY_MAX_LENGTH = 100
export const TIME_ZONE_MAX_LENGTH = 64
const PLACEHOLDER_ZONES = /^(?:factory|etc\/unknown)$/i

/**
 * The canonical spelling of an IANA time zone the runtime knows (`asia/riyadh` → `Asia/Riyadh`),
 * or null. ICU's placeholder zones `Factory` and `Etc/Unknown` are refused.
 */
export function canonicalTimeZone(value: string): string | null {
  if (value === '' || value.length > TIME_ZONE_MAX_LENGTH || PLACEHOLDER_ZONES.test(value)) {
    return null
  }
  let zone: string
  try {
    zone = new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone
  } catch {
    return null
  }
  return PLACEHOLDER_ZONES.test(zone) ? null : zone
}

/** Optional time zone; '' becomes null, which toRow replaces with the country's zone. */
export const locationTimeZoneSchema = z
  .string()
  .trim()
  .max(TIME_ZONE_MAX_LENGTH)
  .transform((value, ctx) => {
    if (value === '') return null
    const zone = canonicalTimeZone(value)
    if (zone !== null) return zone
    ctx.addIssue({ code: 'custom', message: 'timeZone', params: { key: 'timeZone' } })
    return z.NEVER
  })

export const locationSchema = z.object({
  code: codeSchema(),
  name_en: nameEnSchema,
  name_ar: nameArSchema,
  location_type: z.enum(LOCATION_TYPES),
  country_code: z.string().trim().min(1).pipe(countryCodeSchema),
  city: optionalText(CITY_MAX_LENGTH),
  latitude: optionalDecimalSchema({ scale: 6, integerDigits: 3, min: -90, max: 90 }),
  longitude: optionalDecimalSchema({ scale: 6, integerDigits: 3, min: -180, max: 180 }),
  timezone: locationTimeZoneSchema,
  parent_location_id: optionalUuidSchema,
  work_calendar_id: optionalUuidSchema,
  is_active: z.boolean(),
})

export type LocationInput = z.output<typeof locationSchema>

/** Adds `parent: { code, name_en }` to each row (one query for the page's distinct parents). */
export function withParents(
  rows: EntityRow[],
  parents: ReadonlyArray<{ id: string; code: string; name_en: string }>,
): EntityRow[] {
  const byId = new Map(parents.map((parent) => [parent.id, parent]))
  return rows.map((row) => ({
    ...row,
    parent:
      typeof row.parent_location_id === 'string'
        ? (byId.get(row.parent_location_id) ?? null)
        : null,
  }))
}

export const locations = defineEntity({
  key: 'locations',
  table: 'locations',
  namespace: 'Locations',
  area: 'locations',
  tab: 'locations',
  basePath: '/locations',
  // The parent is added by enrichRows: PostgREST does not embed the self-referencing composite
  // foreign key many-to-one.
  listSelect:
    'id, code, name_en, name_ar, location_type, country_code, city, parent_location_id, is_active, calendar:work_calendars!locations_work_calendar_fkey(code, name_en)',
  editSelect:
    'id, code, name_en, name_ar, location_type, country_code, city, latitude, longitude, timezone, parent_location_id, work_calendar_id, is_active, updated_at',
  list: {
    // Indexes: locations_organization_id_code_key, locations_name_idx (name_en, code). Location
    // counts stay small, so sorting by type needs no index of its own.
    sorts: ['code', 'name_en', 'location_type'],
    defaultSort: 'code',
    defaultDir: 'asc',
    tiebreak: 'code',
    filters: [
      { param: 'type', column: 'location_type', kind: 'enum', values: LOCATION_TYPES },
      { param: 'country', column: 'country_code', kind: 'pattern', pattern: /^[A-Z]{2}$/ },
      { param: 'active', column: 'is_active', kind: 'boolean' },
    ],
    search: true,
  },
  filterOptions: { country: 'countries' },
  async enrichRows(rows, { supabase, organizationId }) {
    const ids = [
      ...new Set(
        rows
          .map((row) => row.parent_location_id)
          .filter((id): id is string => typeof id === 'string'),
      ),
    ]
    if (ids.length === 0) return withParents(rows, [])
    const { data } = await supabase
      .from('locations')
      .select('id, code, name_en')
      .eq('organization_id', organizationId)
      .in('id', ids)
      .retry(false)
    return withParents(rows, data ?? [])
  },
  columns: [
    { key: 'code', kind: 'code', sortable: true, link: true },
    { key: 'name', kind: 'name', sortable: true, sortBy: 'name_en' },
    { key: 'location_type', kind: 'badge', sortable: true },
    { key: 'country_code', kind: 'code' },
    { key: 'city', kind: 'text' },
    { key: 'parent', kind: 'ref' },
    { key: 'calendar', kind: 'ref' },
    { key: 'is_active', kind: 'boolean' },
  ],
  fields: [
    { name: 'code', kind: 'code', required: true, maxLength: 64, hint: true },
    {
      name: 'location_type',
      kind: 'select',
      required: true,
      options: { source: 'enum', values: LOCATION_TYPES },
    },
    { name: 'name_en', kind: 'text', required: true, maxLength: 200 },
    { name: 'name_ar', kind: 'nameAr', maxLength: 200 },
    { name: 'country_code', kind: 'select', required: true, options: { source: 'countries' } },
    { name: 'city', kind: 'text', maxLength: CITY_MAX_LENGTH },
    { name: 'latitude', kind: 'decimal', hint: true },
    { name: 'longitude', kind: 'decimal', hint: true },
    { name: 'timezone', kind: 'code', maxLength: TIME_ZONE_MAX_LENGTH, hint: true },
    {
      name: 'parent_location_id',
      kind: 'select',
      options: { source: 'locations' },
      excludeSelf: true,
      hint: true,
    },
    { name: 'work_calendar_id', kind: 'select', options: { source: 'work_calendars' }, hint: true },
    { name: 'is_active', kind: 'switch', hint: true },
  ],
  schema: locationSchema,
  async toRow(input, { supabase }) {
    if (input.timezone !== null) return { ok: true, row: { ...input } }
    // No zone typed: the country's own (regional config lives in the countries table).
    const { data } = await supabase
      .from('countries')
      .select('timezone')
      .eq('code', input.country_code)
      .maybeSingle()
    if (!data) return { ok: false, fieldErrors: { country_code: 'missingReference' } }
    return { ok: true, row: { ...input, timezone: data.timezone } }
  },
  defaults: ({ organization }) => ({
    location_type: 'branch',
    country_code: organization.home_country,
    is_active: true,
  }),
  titleOf: (row) => String(row.code ?? ''),
  constraintFields: {
    locations_check: 'parent_location_id',
    locations_work_calendar_fkey: 'work_calendar_id',
  },
  // A location as its own parent (locations_check) and longer loops (MQ422) read the same.
  constraintMessages: { locations_check: 'cycle' },
  hintMessages: { parent_location_id: 'cycle' },
})
