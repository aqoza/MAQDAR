import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { fieldErrorsFrom, type ValidationTranslator } from '../../validation'
import { placeWriteError } from '../errors'
import { parseListParams } from '../list-params'
import { fxRates, fxRateSchema, rateInputValue } from './fx-rates'

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

const validRate = {
  from_currency: 'usd',
  to_currency: 'SAR',
  valid_from: '2026-10-01',
  rate: '3.75',
  note: '',
}

describe('fxRateSchema', () => {
  it('parses a valid rate', () => {
    expect(fxRateSchema.parse(validRate)).toEqual({
      from_currency: 'USD',
      to_currency: 'SAR',
      valid_from: '2026-10-01',
      rate: 3.75,
      note: null,
    })
  })

  it('keeps up to 10 decimals and 10 integer digits', () => {
    expect(fxRateSchema.parse({ ...validRate, rate: '0.0000000001' }).rate).toBe(1e-10)
    expect(fxRateSchema.parse({ ...validRate, rate: '0.2666666667' }).rate).toBe(0.2666666667)
    expect(fxRateSchema.parse({ ...validRate, rate: '1,234,567,890' }).rate).toBe(1234567890)
    expect(fxRateSchema.parse({ ...validRate, rate: '٣٫٧٥' }).rate).toBe(3.75)
  })

  it('refuses rates the column would round or cannot hold', () => {
    expect(errorsOf(fxRateSchema, { ...validRate, rate: '0.00000000001' })).toEqual({
      rate: 'decimal:scale=10',
    })
    expect(errorsOf(fxRateSchema, { ...validRate, rate: '12345678901' })).toEqual({
      rate: 'tooManyDigits:max=10',
    })
    expect(errorsOf(fxRateSchema, { ...validRate, rate: '1234567.123456789' })).toEqual({
      rate: 'precision:max=15',
    })
  })

  it('requires a positive rate', () => {
    expect(errorsOf(fxRateSchema, { ...validRate, rate: '0' })).toEqual({
      rate: 'greaterThan:min=0',
    })
    expect(errorsOf(fxRateSchema, { ...validRate, rate: '-3.75' })).toEqual({
      rate: 'greaterThan:min=0',
    })
    expect(errorsOf(fxRateSchema, { ...validRate, rate: '' })).toEqual({ rate: 'required' })
  })

  it('reports each invalid field', () => {
    expect(
      errorsOf(fxRateSchema, {
        from_currency: '',
        to_currency: 'riyal',
        valid_from: '01/10/2026',
        rate: 'abc',
        note: 'x'.repeat(1001),
      }),
    ).toEqual({
      from_currency: 'required',
      to_currency: 'currency',
      valid_from: 'date',
      rate: 'number',
      note: 'tooLong:max=1000',
    })
    expect(errorsOf(fxRateSchema, { ...validRate, valid_from: '' })).toEqual({
      valid_from: 'required',
    })
  })

  it('requires two different currencies', () => {
    expect(errorsOf(fxRateSchema, { ...validRate, to_currency: 'usd' })).toEqual({
      to_currency: 'mustDiffer',
    })
  })
})

describe('rateInputValue', () => {
  it('drops the trailing zeros of the exact stored text', () => {
    expect(rateInputValue('3.6725000000')).toBe('3.6725')
    expect(rateInputValue('4.0000000000')).toBe('4')
    expect(rateInputValue('1234567890.1234567890')).toBe('1234567890.123456789')
    expect(rateInputValue('0.0000000001')).toBe('0.0000000001')
    expect(rateInputValue('120')).toBe('120')
  })

  it('falls back to plain number text', () => {
    expect(rateInputValue(3.75)).toBe('3.75')
    expect(rateInputValue(1e-10)).toBe('0.0000000001')
    expect(rateInputValue(null)).toBe('')
  })
})

describe('fxRates definition', () => {
  it('lists the newest rates first and filters by currency codes', () => {
    const params = parseListParams({ from: 'USD', to: 'sar' }, fxRates.list)
    expect(params.sort).toBe('valid_from')
    expect(params.dir).toBe('desc')
    expect(params.q).toBe('')
    expect(params.filters).toEqual({ from: 'USD' })
  })

  it('maps the stored row back to form values', () => {
    expect(
      fxRates.toForm?.({
        id: '1b4e28ba-2fa1-11d2-883f-0016d3cca427',
        from_currency: 'KWD',
        to_currency: 'SAR',
        valid_from: '2026-10-01',
        rate: '12.2500000000',
        note: null,
        updated_at: '2026-10-11T08:00:00.123456+00:00',
      }),
    ).toEqual({
      from_currency: 'KWD',
      to_currency: 'SAR',
      valid_from: '2026-10-01',
      rate: '12.25',
      note: '',
    })
  })

  it('names the pair and date in the title', () => {
    expect(
      fxRates.titleOf({ from_currency: 'USD', to_currency: 'SAR', valid_from: '2026-10-01' }),
    ).toBe('USD → SAR · 2026-10-01')
  })

  it('explains duplicate pairs on the date field', () => {
    const error = (code: string, constraint: string) => ({
      code,
      message: `duplicate key value violates unique constraint "${constraint}"`,
    })
    expect(placeWriteError(fxRates, error('23505', 'fx_rates_unordered_pair_date_key'))).toEqual({
      scope: 'field',
      field: 'valid_from',
      key: 'reverseRateExists',
    })
    expect(placeWriteError(fxRates, error('23505', 'fx_rates_pair_date_key'))).toEqual({
      scope: 'field',
      field: 'valid_from',
      key: 'duplicate',
    })
    expect(placeWriteError(fxRates, error('23514', 'fx_rates_check'))).toEqual({
      scope: 'field',
      field: 'to_currency',
      key: 'invalid',
    })
    expect(placeWriteError(fxRates, error('23514', 'fx_rates_rate_check'))).toEqual({
      scope: 'field',
      field: 'rate',
      key: 'invalid',
    })
  })
})
