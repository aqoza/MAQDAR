import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { fieldErrorsFrom, type ValidationTranslator } from '../../validation'
import { placeWriteError } from '../errors'
import { parseListParams } from '../list-params'
import { suppliers, supplierSchema } from './suppliers'

/** Stub translator: renders the key and its ICU arguments so tests can assert on both. */
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

const CALENDAR_ID = '1b4e28ba-2fa1-11d2-883f-0016d3cca427'

const validSupplier = {
  code: 'SUP-JP.01',
  name_en: 'Nippon Parts',
  name_ar: 'نيبون للقطع',
  country_code: 'jp',
  currency: 'usd',
  lead_time_days_p50: '٤٥',
  lead_time_days_p90: '60',
  work_calendar_id: CALENDAR_ID.toUpperCase(),
  is_active: true,
}

describe('supplierSchema', () => {
  it('parses a valid supplier', () => {
    expect(supplierSchema.parse(validSupplier)).toEqual({
      code: 'SUP-JP.01',
      name_en: 'Nippon Parts',
      name_ar: 'نيبون للقطع',
      country_code: 'JP',
      currency: 'USD',
      lead_time_days_p50: 45,
      lead_time_days_p90: 60,
      work_calendar_id: CALENDAR_ID,
      is_active: true,
    })
  })

  it('treats the calendar and Arabic name as optional', () => {
    const parsed = supplierSchema.parse({ ...validSupplier, work_calendar_id: '', name_ar: ' ' })
    expect(parsed.work_calendar_id).toBeNull()
    expect(parsed.name_ar).toBeNull()
  })

  it('accepts any two-letter country, not only the regional ones', () => {
    expect(supplierSchema.parse({ ...validSupplier, country_code: ' cn ' }).country_code).toBe('CN')
  })

  it('reports each invalid field', () => {
    expect(
      errorsOf(supplierSchema, {
        code: 'SUP/1',
        name_en: '',
        name_ar: 'x'.repeat(201),
        country_code: 'JPN',
        currency: 'dollar',
        lead_time_days_p50: '-1',
        lead_time_days_p90: '4.5',
        work_calendar_id: 'standard',
        is_active: false,
      }),
    ).toEqual({
      code: 'codeFormat',
      name_en: 'required',
      name_ar: 'tooLong:max=200',
      country_code: 'country',
      currency: 'currency',
      lead_time_days_p50: 'minValue:min=0',
      lead_time_days_p90: 'integer',
      work_calendar_id: 'invalidChoice',
    })
  })

  it('requires the country, currency and both lead times', () => {
    expect(
      errorsOf(supplierSchema, {
        ...validSupplier,
        country_code: '',
        currency: '',
        lead_time_days_p50: '',
        lead_time_days_p90: ' ',
      }),
    ).toEqual({
      country_code: 'required',
      currency: 'required',
      lead_time_days_p50: 'required',
      lead_time_days_p90: 'required',
    })
  })

  it('requires the slow lead time to be at least the typical one', () => {
    expect(
      errorsOf(supplierSchema, {
        ...validSupplier,
        lead_time_days_p50: '30',
        lead_time_days_p90: '29',
      }),
    ).toEqual({ lead_time_days_p90: 'p90BelowP50' })
    expect(
      supplierSchema.safeParse({
        ...validSupplier,
        lead_time_days_p50: '30',
        lead_time_days_p90: '30',
      }).success,
    ).toBe(true)
  })

  it('refuses lead times an integer column cannot hold', () => {
    expect(
      errorsOf(supplierSchema, { ...validSupplier, lead_time_days_p90: '1234567890' }),
    ).toEqual({ lead_time_days_p90: 'tooManyDigits:max=9' })
  })
})

describe('suppliers definition', () => {
  it('filters by currency code and active flag only when well formed', () => {
    const params = parseListParams(
      { currency: 'KWD', active: 'false', sort: 'lead_time_days_p50' },
      suppliers.list,
    )
    expect(params.filters).toEqual({ currency: 'KWD', active: 'false' })
    expect(params.sort).toBe('lead_time_days_p50')
    expect(params.dir).toBe('asc')
    expect(
      parseListParams({ currency: 'kwd; drop', active: 'yes' }, suppliers.list).filters,
    ).toEqual({})
  })

  it('seeds new suppliers from the organization', () => {
    expect(
      suppliers.defaults?.({ organization: { base_currency: 'SAR', home_country: 'SA' } }),
    ).toEqual({ country_code: 'SA', currency: 'SAR', is_active: true })
  })

  it('puts constraint errors on their fields', () => {
    const error = (code: string, constraint: string) => ({
      code,
      message: `violates constraint "${constraint}"`,
    })
    expect(
      placeWriteError(suppliers, error('23505', 'suppliers_organization_id_code_key')),
    ).toEqual({ scope: 'field', field: 'code', key: 'codeTaken' })
    expect(placeWriteError(suppliers, error('23514', 'suppliers_check'))).toEqual({
      scope: 'field',
      field: 'lead_time_days_p90',
      key: 'invalid',
    })
    expect(placeWriteError(suppliers, error('23503', 'suppliers_work_calendar_fkey'))).toEqual({
      scope: 'field',
      field: 'work_calendar_id',
      key: 'missingReference',
    })
    expect(placeWriteError(suppliers, error('23503', 'suppliers_currency_fkey'))).toEqual({
      scope: 'field',
      field: 'currency',
      key: 'missingReference',
    })
  })
})
