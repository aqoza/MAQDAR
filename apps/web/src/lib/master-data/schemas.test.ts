import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { fieldErrorsFrom, type ValidationTranslator } from '../validation'
import { brandSchema, codeSchema, itemSchema, nameArSchema, optionalDateSchema } from './schemas'

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

const BRAND_ID = '1b4e28ba-2fa1-11d2-883f-0016d3cca427'

const validItem = {
  code: 'FLT-100/A',
  name_en: 'Oil filter',
  name_ar: 'فلتر زيت',
  brand_id: BRAND_ID,
  product_group: 'Filters',
  unit_of_measure: 'EA',
  unit_cost: '1,250.5',
  currency: 'kwd',
  status: 'active',
  introduced_on: '2025-01-01',
  discontinued_on: '',
}

describe('codeSchema', () => {
  it('mirrors the database code check', () => {
    expect(codeSchema().parse(' BR-1.x_2 ')).toBe('BR-1.x_2')
    expect(codeSchema({ allowSlash: true }).parse('A/B')).toBe('A/B')
    expect(codeSchema().safeParse('A/B').success).toBe(false)
    expect(codeSchema().safeParse('-A').success).toBe(false)
    expect(codeSchema().safeParse('A'.repeat(65)).success).toBe(false)
    expect(codeSchema().safeParse('A'.repeat(64)).success).toBe(true)
  })

  it('names its own message', () => {
    expect(errorsOf(z.object({ code: codeSchema() }), { code: 'a b' })).toEqual({
      code: 'codeFormat',
    })
    expect(errorsOf(z.object({ code: codeSchema({ allowSlash: true }) }), { code: '/x' })).toEqual({
      code: 'itemCodeFormat',
    })
    expect(errorsOf(z.object({ code: codeSchema() }), { code: '  ' })).toEqual({
      code: 'required',
    })
  })
})

describe('shared pieces', () => {
  it('turns an empty Arabic name into null', () => {
    expect(nameArSchema.parse('  ')).toBeNull()
    expect(nameArSchema.parse(' قطع ')).toBe('قطع')
  })

  it('validates optional dates', () => {
    expect(optionalDateSchema.parse('')).toBeNull()
    expect(optionalDateSchema.parse('2026-02-28')).toBe('2026-02-28')
    expect(errorsOf(z.object({ d: optionalDateSchema }), { d: '2026-13-01' })).toEqual({
      d: 'date',
    })
    expect(errorsOf(z.object({ d: optionalDateSchema }), { d: '11/10/2026' })).toEqual({
      d: 'date',
    })
  })
})

describe('itemSchema', () => {
  it('parses a valid item', () => {
    expect(itemSchema.parse(validItem)).toEqual({
      code: 'FLT-100/A',
      name_en: 'Oil filter',
      name_ar: 'فلتر زيت',
      brand_id: BRAND_ID,
      product_group: 'Filters',
      unit_of_measure: 'EA',
      unit_cost: 1250.5,
      currency: 'KWD',
      status: 'active',
      introduced_on: '2025-01-01',
      discontinued_on: null,
    })
  })

  it('treats the brand and Arabic name as optional', () => {
    const parsed = itemSchema.parse({ ...validItem, brand_id: '', name_ar: '' })
    expect(parsed.brand_id).toBeNull()
    expect(parsed.name_ar).toBeNull()
  })

  it('accepts Arabic-Indic digits in the cost', () => {
    expect(itemSchema.parse({ ...validItem, unit_cost: '١٢٫٥' }).unit_cost).toBe(12.5)
  })

  it('reports each invalid field', () => {
    expect(
      errorsOf(itemSchema, {
        code: '',
        name_en: '',
        name_ar: 'x'.repeat(201),
        brand_id: 'nope',
        product_group: 'x'.repeat(65),
        unit_of_measure: 'BOX',
        unit_cost: '-1',
        currency: 'riyal',
        status: 'gone',
        introduced_on: 'soon',
        discontinued_on: '',
      }),
    ).toEqual({
      code: 'required',
      name_en: 'required',
      name_ar: 'tooLong:max=200',
      brand_id: 'invalidChoice',
      product_group: 'tooLong:max=64',
      unit_of_measure: 'invalidChoice',
      unit_cost: 'minValue:min=0',
      currency: 'currency',
      status: 'invalidChoice',
      introduced_on: 'date',
    })
  })

  it('refuses costs the column would round or cannot hold', () => {
    expect(errorsOf(itemSchema, { ...validItem, unit_cost: '1.2345' })).toEqual({
      unit_cost: 'decimal:scale=3',
    })
    expect(errorsOf(itemSchema, { ...validItem, unit_cost: '1234567890123' })).toEqual({
      unit_cost: 'tooManyDigits:max=12',
    })
    expect(errorsOf(itemSchema, { ...validItem, unit_cost: '1,23' })).toEqual({
      unit_cost: 'number',
    })
    expect(errorsOf(itemSchema, { ...validItem, unit_cost: '' })).toEqual({
      unit_cost: 'required',
    })
  })

  it('requires the discontinuation date to follow the introduction date', () => {
    expect(
      errorsOf(itemSchema, {
        ...validItem,
        introduced_on: '2026-05-01',
        discontinued_on: '2026-04-30',
      }),
    ).toEqual({ discontinued_on: 'endBeforeStart' })
    expect(
      itemSchema.safeParse({
        ...validItem,
        introduced_on: '2026-05-01',
        discontinued_on: '2026-05-01',
      }).success,
    ).toBe(true)
  })
})

describe('brandSchema', () => {
  const validBrand = {
    code: 'TOYOTA',
    name_en: 'Toyota',
    name_ar: 'تويوتا',
    brand_type: 'oem',
    country_of_origin: 'jp',
    is_active: true,
  }

  it('parses a valid brand', () => {
    expect(brandSchema.parse(validBrand)).toEqual({ ...validBrand, country_of_origin: 'JP' })
  })

  it('treats the type, origin and Arabic name as optional', () => {
    expect(
      brandSchema.parse({ ...validBrand, brand_type: '', country_of_origin: '', name_ar: '' }),
    ).toEqual({
      ...validBrand,
      brand_type: null,
      country_of_origin: null,
      name_ar: null,
    })
  })

  it('reports invalid fields', () => {
    expect(
      errorsOf(brandSchema, {
        code: 'TOY OTA',
        name_en: ' ',
        name_ar: '',
        brand_type: 'dealer',
        country_of_origin: 'JPN',
        is_active: true,
      }),
    ).toEqual({
      code: 'codeFormat',
      name_en: 'required',
      brand_type: 'invalidChoice',
      country_of_origin: 'country',
    })
  })

  it('refuses slashes in brand codes', () => {
    expect(errorsOf(brandSchema, { ...validBrand, code: 'A/B' })).toEqual({ code: 'codeFormat' })
  })
})
