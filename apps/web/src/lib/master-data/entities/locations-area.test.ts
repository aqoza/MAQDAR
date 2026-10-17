import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { fieldErrorsFrom, type ValidationTranslator } from '../../validation'
import { placeDeleteError, placeWriteError } from '../errors'
import type { EntityContext } from '../types'
import {
  daysBetween,
  holidayOverrideSchema,
  holidayOverrides,
  parseHolidayScope,
} from './holiday-overrides'
import { canonicalTimeZone, locationSchema, locations, withParents } from './locations'
import { networkLinkRow, networkLinkSchema, networkLinks } from './network-links'
import { weekendDaysSchema, workCalendarSchema, workCalendars } from './work-calendars'

/** Schemas and helpers of the Locations area: locations, lanes, calendars and overrides. */

const t: ValidationTranslator = (key, values) =>
  values
    ? `${key}:${Object.entries(values)
        .map(([k, v]) => `${k}=${v}`)
        .join(',')}`
    : key

function errorsOf(schema: z.ZodType, input: unknown) {
  const result = schema.safeParse(input)
  if (result.success) throw new Error('expected a validation failure')
  return fieldErrorsFrom(result.error, t).fieldErrors
}

const LOCATION_A = '1b4e28ba-2fa1-11d2-883f-0016d3cca427'
const LOCATION_B = '6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b'
const CALENDAR = '0f8fad5b-d9cb-469f-a165-70867728950e'

describe('locationSchema', () => {
  const valid = {
    code: 'RUH-DC',
    name_en: 'Riyadh distribution centre',
    name_ar: '',
    location_type: 'central',
    country_code: 'sa',
    city: ' Riyadh ',
    latitude: '٢٤٫٧١٣٦',
    longitude: '46.675296',
    timezone: 'asia/riyadh',
    parent_location_id: '',
    work_calendar_id: CALENDAR.toUpperCase(),
    is_active: true,
  }

  it('parses a valid location', () => {
    expect(locationSchema.parse(valid)).toEqual({
      code: 'RUH-DC',
      name_en: 'Riyadh distribution centre',
      name_ar: null,
      location_type: 'central',
      country_code: 'SA',
      city: 'Riyadh',
      latitude: 24.7136,
      longitude: 46.675296,
      timezone: 'Asia/Riyadh',
      parent_location_id: null,
      work_calendar_id: CALENDAR,
      is_active: true,
    })
  })

  it('leaves an empty time zone for the country default', () => {
    expect(locationSchema.parse({ ...valid, timezone: '', city: '' })).toMatchObject({
      timezone: null,
      city: null,
    })
  })

  it('reports each field', () => {
    expect(
      errorsOf(locationSchema, {
        ...valid,
        code: 'RUH DC',
        name_en: '',
        location_type: 'warehouse',
        country_code: '',
        latitude: '90.5',
        longitude: '12.1234567',
        timezone: 'Mars/Olympus',
        parent_location_id: 'not-a-uuid',
      }),
    ).toEqual({
      code: 'codeFormat',
      name_en: 'required',
      location_type: 'invalidChoice',
      country_code: 'required',
      latitude: 'maxValue:max=90',
      longitude: 'decimal:scale=6',
      timezone: 'timeZone',
      parent_location_id: 'invalidChoice',
    })
    expect(errorsOf(locationSchema, { ...valid, longitude: '-180.5' })).toEqual({
      longitude: 'minValue:min=-180',
    })
    expect(errorsOf(locationSchema, { ...valid, country_code: 'SAU' })).toEqual({
      country_code: 'country',
    })
  })
})

describe('canonicalTimeZone', () => {
  it('accepts IANA zones in their canonical spelling', () => {
    expect(canonicalTimeZone('Asia/Dubai')).toBe('Asia/Dubai')
    expect(canonicalTimeZone('africa/cairo')).toBe('Africa/Cairo')
    expect(canonicalTimeZone('UTC')).toBe('UTC')
  })

  it('refuses unknown and placeholder zones', () => {
    expect(canonicalTimeZone('')).toBeNull()
    expect(canonicalTimeZone('Asia/Atlantis')).toBeNull()
    expect(canonicalTimeZone('Factory')).toBeNull()
    expect(canonicalTimeZone('factory')).toBeNull()
    expect(canonicalTimeZone('Etc/Unknown')).toBeNull()
    expect(canonicalTimeZone(`Asia/${'x'.repeat(64)}`)).toBeNull()
  })
})

describe('locations definition', () => {
  it('adds the parent of each row', () => {
    const rows = [
      { id: '1', code: 'A', parent_location_id: LOCATION_A },
      { id: '2', code: 'B', parent_location_id: null },
      { id: '3', code: 'C', parent_location_id: LOCATION_B },
    ]
    expect(withParents(rows, [{ id: LOCATION_A, code: 'RUH-DC', name_en: 'Riyadh' }])).toEqual([
      { ...rows[0], parent: { id: LOCATION_A, code: 'RUH-DC', name_en: 'Riyadh' } },
      { ...rows[1], parent: null },
      // Not visible to this user (branch scoping) or deleted meanwhile.
      { ...rows[2], parent: null },
    ])
  })

  it('maps the cycle guard and the self-parent check to the parent field', () => {
    expect(locations.hintMessages).toEqual({ parent_location_id: 'cycle' })
    expect(locations.constraintFields?.locations_check).toBe('parent_location_id')
    expect(locations.fields.find((field) => field.name === 'parent_location_id')).toMatchObject({
      excludeSelf: true,
    })
  })

  it('keeps a typed time zone without a lookup', async () => {
    const input = locationSchema.parse({
      code: 'X',
      name_en: 'X',
      name_ar: '',
      location_type: 'branch',
      country_code: 'AE',
      city: '',
      latitude: '',
      longitude: '',
      timezone: 'Asia/Dubai',
      parent_location_id: '',
      work_calendar_id: '',
      is_active: false,
    })
    const ctx = { supabase: null, organizationId: LOCATION_A } as unknown as EntityContext
    await expect(locations.toRow(input, ctx)).resolves.toEqual({
      ok: true,
      row: input,
    })
  })
})

describe('networkLinkSchema', () => {
  const valid = {
    from_location_id: LOCATION_A,
    to_location_id: LOCATION_B,
    lead_time_days_p50: '3',
    lead_time_days_p90: '٧',
    freight_basis: 'per_shipment',
    freight_cost: '1,250.5',
    currency: 'sar',
    is_active: true,
  }

  it('parses a lane with a freight cost', () => {
    expect(networkLinkSchema.parse(valid)).toEqual({
      ...valid,
      lead_time_days_p50: 3,
      lead_time_days_p90: 7,
      freight_cost: 1250.5,
      freight_unit: null,
      freight_valid_from: null,
      currency: 'SAR',
    })
  })

  it('stores no cost or currency without a cost basis', () => {
    const parsed = networkLinkSchema.parse({ ...valid, freight_basis: 'none' })
    expect(networkLinkRow(parsed)).toMatchObject({
      freight_basis: 'none',
      freight_cost: null,
      currency: null,
    })
    expect(networkLinks.toRow(parsed, {} as EntityContext)).toEqual({
      ok: true,
      row: networkLinkRow(parsed),
    })
    expect(
      networkLinkSchema.parse({ ...valid, freight_basis: 'none', freight_cost: '', currency: '' }),
    ).toMatchObject({ freight_cost: null, currency: null })
  })

  it('requires the cost and currency of a cost basis', () => {
    expect(
      errorsOf(networkLinkSchema, {
        ...valid,
        freight_basis: 'per_unit',
        freight_cost: '',
        currency: '',
      }),
    ).toEqual({ freight_cost: 'required', currency: 'required' })
  })

  it('refuses a self-link and a slow lead time below the typical one', () => {
    expect(
      errorsOf(networkLinkSchema, {
        ...valid,
        to_location_id: LOCATION_A.toUpperCase(),
        lead_time_days_p90: '2',
      }),
    ).toEqual({ to_location_id: 'mustDiffer', lead_time_days_p90: 'p90BelowP50' })
  })

  it('checks each field', () => {
    expect(
      errorsOf(networkLinkSchema, {
        ...valid,
        from_location_id: '',
        lead_time_days_p50: '1.5',
        lead_time_days_p90: '3651',
        freight_basis: 'per_pallet',
        freight_cost: '-1',
        currency: 'SA',
      }),
    ).toEqual({
      from_location_id: 'required',
      lead_time_days_p50: 'integer',
      lead_time_days_p90: 'maxValue:max=3650',
      freight_basis: 'invalidChoice',
      freight_cost: 'minValue:min=0',
      currency: 'currency',
    })
  })

  it('maps lane constraints to fields and titles the lane by its codes', () => {
    expect(networkLinks.constraintFields).toMatchObject({
      network_links_lane_key: 'to_location_id',
      network_links_check: 'to_location_id',
      network_links_check1: 'lead_time_days_p90',
      network_links_freight_check: 'freight_cost',
    })
    expect(networkLinks.titleOf({ from_code: 'RUH-DC', to_location: { code: 'DXB-HUB' } })).toBe(
      'RUH-DC → DXB-HUB',
    )
    expect(networkLinks.titleOf({ from_code: null, to_location: null })).toBe('— → —')
  })
})

describe('workCalendarSchema', () => {
  const valid = {
    code: 'KSA-5DAY',
    name_en: 'Saudi five-day week',
    name_ar: 'أسبوع عمل سعودي',
    country_code: 'sa',
    weekend_days: ['6', '5', '5'],
    observe_public_holidays: true,
    is_active: true,
  }

  it('parses weekend days as distinct sorted ISO weekdays', () => {
    expect(workCalendarSchema.parse(valid)).toEqual({
      ...valid,
      country_code: 'SA',
      weekend_days: [5, 6],
    })
    expect(weekendDaysSchema.parse([])).toEqual([])
    expect(weekendDaysSchema.parse(['7', '1'])).toEqual([1, 7])
  })

  it('refuses unknown days and a week without working days', () => {
    expect(errorsOf(workCalendarSchema, { ...valid, weekend_days: ['0', '8'] })).toEqual({
      weekend_days: 'invalidChoice',
    })
    expect(
      errorsOf(workCalendarSchema, { ...valid, weekend_days: ['1', '2', '3', '4', '5', '6', '7'] }),
    ).toEqual({ weekend_days: 'tooMany:max=6' })
  })

  it('needs a country to observe public holidays', () => {
    expect(errorsOf(workCalendarSchema, { ...valid, country_code: '' })).toEqual({
      country_code: 'countryRequired',
    })
    expect(
      workCalendarSchema.parse({ ...valid, country_code: '', observe_public_holidays: false }),
    ).toMatchObject({ country_code: null, observe_public_holidays: false })
    expect(workCalendars.constraintFields).toEqual({
      work_calendars_holidays_need_country: 'country_code',
    })
  })
})

describe('database errors of the Locations area', () => {
  const violation = (code: string, constraint: string) => ({
    code,
    message: `violates constraint "${constraint}"`,
  })

  it('places them on the field that caused them', () => {
    expect(
      placeWriteError(locations, {
        code: 'MQ422',
        message: 'this parent would create a cycle',
        hint: 'parent_location_id',
      }),
    ).toEqual({ scope: 'field', field: 'parent_location_id', key: 'cycle' })
    expect(placeWriteError(locations, violation('23514', 'locations_check'))).toEqual({
      scope: 'field',
      field: 'parent_location_id',
      key: 'cycle',
    })
    expect(
      placeWriteError(locations, violation('23505', 'locations_organization_id_code_key')),
    ).toEqual({ scope: 'field', field: 'code', key: 'codeTaken' })
    expect(placeWriteError(networkLinks, violation('23505', 'network_links_lane_key'))).toEqual({
      scope: 'field',
      field: 'to_location_id',
      key: 'duplicate',
    })
    expect(
      placeWriteError(workCalendars, violation('23514', 'work_calendars_weekend_days_check')),
    ).toEqual({ scope: 'field', field: 'weekend_days', key: 'invalid' })
    expect(
      placeWriteError(holidayOverrides, violation('23P01', 'holiday_overrides_no_overlap')),
    ).toEqual({ scope: 'field', field: 'starts_on', key: 'overlap' })
  })

  it('explains refused deletes', () => {
    expect(placeDeleteError({ code: 'MQ409', message: 'locations with demand history' })).toEqual({
      scope: 'form',
      key: 'hasDemand',
    })
    expect(placeDeleteError(violation('23503', 'locations_work_calendar_fkey'))).toEqual({
      scope: 'form',
      key: 'inUse',
    })
  })
})

describe('holidayOverrideSchema', () => {
  const valid = {
    scope: 'country:sa',
    starts_on: '2027-03-09',
    ends_on: '2027-03-12',
    kind: 'closure',
    name_en: 'Eid al-Fitr',
    name_ar: 'عيد الفطر',
    note: '',
  }

  it('parses both kinds of scope', () => {
    expect(parseHolidayScope('country:ae')).toEqual({ country_code: 'AE', work_calendar_id: null })
    expect(parseHolidayScope(`calendar:${CALENDAR.toUpperCase()}`)).toEqual({
      country_code: null,
      work_calendar_id: CALENDAR,
    })
    for (const bad of ['', 'country', 'country:SAU', 'calendar:123', 'region:SA', ':SA']) {
      expect(parseHolidayScope(bad), bad).toBeNull()
    }
  })

  it('turns the scope into its two columns', () => {
    const parsed = holidayOverrideSchema.parse(valid)
    expect(parsed).toEqual({
      ...valid,
      scope: { country_code: 'SA', work_calendar_id: null },
      note: null,
    })
    expect(holidayOverrides.toRow(parsed, {} as EntityContext)).toEqual({
      ok: true,
      row: {
        starts_on: '2027-03-09',
        ends_on: '2027-03-12',
        kind: 'closure',
        name_en: 'Eid al-Fitr',
        name_ar: 'عيد الفطر',
        note: null,
        country_code: 'SA',
        work_calendar_id: null,
      },
    })
  })

  it('checks the range', () => {
    expect(daysBetween('2027-01-01', '2027-12-31')).toBe(364)
    expect(daysBetween('2028-01-01', '2028-12-31')).toBe(365)
    expect(holidayOverrideSchema.safeParse({ ...valid, ends_on: valid.starts_on }).success).toBe(
      true,
    )
    // 366 days in all (a leap year) is the longest range.
    expect(
      holidayOverrideSchema.safeParse({ ...valid, starts_on: '2028-01-01', ends_on: '2028-12-31' })
        .success,
    ).toBe(true)
    expect(
      errorsOf(holidayOverrideSchema, { ...valid, starts_on: '2027-01-01', ends_on: '2028-01-02' }),
    ).toEqual({ ends_on: 'rangeTooLong:max=366' })
    expect(errorsOf(holidayOverrideSchema, { ...valid, ends_on: '2027-03-08' })).toEqual({
      ends_on: 'endBeforeStart',
    })
  })

  it('reports each field', () => {
    expect(
      errorsOf(holidayOverrideSchema, {
        scope: 'region:GCC',
        starts_on: '2027-02-30',
        ends_on: '',
        kind: 'holiday',
        name_en: ' ',
        name_ar: '',
        note: 'x'.repeat(1001),
      }),
    ).toEqual({
      scope: 'invalidChoice',
      starts_on: 'date',
      ends_on: 'required',
      kind: 'invalidChoice',
      name_en: 'required',
      note: 'tooLong:max=1000',
    })
    expect(errorsOf(holidayOverrideSchema, { ...valid, scope: '' })).toEqual({
      scope: 'required',
    })
  })

  it('fills the form from the stored scope key and shows one scope cell', async () => {
    const values = holidayOverrides.toForm?.({
      id: CALENDAR,
      scope_key: `calendar:${CALENDAR}`,
      starts_on: '2027-03-09',
      ends_on: '2027-03-09',
      kind: 'working_day',
      name_en: 'Stock count',
      name_ar: null,
      note: null,
    })
    expect(values).toMatchObject({
      scope: `calendar:${CALENDAR}`,
      starts_on: '2027-03-09',
      kind: 'working_day',
      name_ar: '',
      note: '',
    })
    const rows = await holidayOverrides.enrichRows?.(
      [
        { id: '1', country_name: 'Saudi Arabia', calendar: null },
        { id: '2', country_name: null, calendar: { code: 'KSA-5DAY' } },
      ],
      {} as EntityContext,
    )
    expect(rows?.map((row) => row.scope_label)).toEqual(['Saudi Arabia', 'KSA-5DAY'])
    expect(holidayOverrides.titleOf({ starts_on: '2027-03-09', ends_on: '2027-03-09' })).toBe(
      '2027-03-09',
    )
    expect(holidayOverrides.titleOf({ starts_on: '2027-03-09', ends_on: '2027-03-12' })).toBe(
      '2027-03-09 – 2027-03-12',
    )
  })

  it('places overlaps and duplicate starts on the start date', () => {
    expect(holidayOverrides.constraintFields).toMatchObject({
      holiday_overrides_no_overlap: 'starts_on',
      holiday_overrides_scope_start_key: 'starts_on',
      holiday_overrides_range_check: 'ends_on',
    })
  })
})
