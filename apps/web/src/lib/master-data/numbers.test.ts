import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  decimalSchema,
  integerSchema,
  normalizeDigits,
  numberInputValue,
  optionalDecimalSchema,
  optionalIntegerSchema,
  parseDecimal,
  parseInteger,
} from './numbers'

describe('normalizeDigits', () => {
  it('maps Arabic-Indic and extended digits and separators to ASCII', () => {
    expect(normalizeDigits('١٢٣٫٤٥')).toBe('123.45')
    expect(normalizeDigits('۱۲۳۴')).toBe('1234')
    expect(normalizeDigits('١٬٢٣٤')).toBe('1,234')
    expect(normalizeDigits(`${String.fromCodePoint(0x2212)}5`)).toBe('-5')
  })

  it('removes bidi marks and surrounding spaces', () => {
    const [lrm, rlm, alm] = [0x200e, 0x200f, 0x061c].map((code) => String.fromCodePoint(code))
    expect(normalizeDigits(`${rlm} 12.5${lrm} `)).toBe('12.5')
    expect(normalizeDigits(`${alm}٤`)).toBe('4')
  })
})

describe('parseDecimal', () => {
  it('parses plain, grouped and Arabic-Indic input', () => {
    expect(parseDecimal('12.5')).toEqual({ ok: true, value: 12.5 })
    expect(parseDecimal('1,234,567.125')).toEqual({ ok: true, value: 1234567.125 })
    expect(parseDecimal('١٬٢٣٤٫٥')).toEqual({ ok: true, value: 1234.5 })
    expect(parseDecimal('.5')).toEqual({ ok: true, value: 0.5 })
    expect(parseDecimal('5.')).toEqual({ ok: true, value: 5 })
    expect(parseDecimal('007')).toEqual({ ok: true, value: 7 })
    expect(parseDecimal('-2.5')).toEqual({ ok: true, value: -2.5 })
    expect(parseDecimal('-0')).toEqual({ ok: true, value: 0 })
  })

  it('accepts commas only in a valid thousands grouping', () => {
    for (const input of ['1,23', '12,34.5', '1234,567', ',123', '1,,234', '1,234,56']) {
      expect(parseDecimal(input), input).toEqual({ ok: false, issue: 'number' })
    }
  })

  it('refuses text that is not a number', () => {
    for (const input of ['', ' ', '-', '.', 'abc', '1e5', '1.2.3', '+5', '1 000', '0x10']) {
      expect(parseDecimal(input), input).toEqual({ ok: false, issue: 'number' })
    }
  })

  it('refuses more fractional digits than the scale, ignoring trailing zeros', () => {
    expect(parseDecimal('1.2345')).toEqual({ ok: false, issue: 'decimal', values: { scale: 3 } })
    expect(parseDecimal('1.2340')).toEqual({ ok: true, value: 1.234 })
    expect(parseDecimal('0.12345678901', { scale: 10, integerDigits: 10 })).toEqual({
      ok: false,
      issue: 'decimal',
      values: { scale: 10 },
    })
  })

  it('refuses more integer digits than allowed', () => {
    expect(parseDecimal('999999999999.999')).toEqual({ ok: true, value: 999999999999.999 })
    expect(parseDecimal('1,000,000,000,000')).toEqual({
      ok: false,
      issue: 'tooManyDigits',
      values: { max: 12 },
    })
    expect(parseDecimal('000000000000001')).toEqual({ ok: true, value: 1 })
  })

  it('refuses more than 15 significant digits', () => {
    expect(parseDecimal('1234567.123456789', { scale: 10, integerDigits: 10 })).toEqual({
      ok: false,
      issue: 'precision',
      values: { max: 15 },
    })
    expect(parseDecimal('0.0000000001', { scale: 10, integerDigits: 10 })).toEqual({
      ok: true,
      value: 1e-10,
    })
    expect(parseDecimal('12345.1234567891', { scale: 10, integerDigits: 10 })).toEqual({
      ok: true,
      value: 12345.1234567891,
    })
    expect(parseDecimal('123456.1234567891', { scale: 10, integerDigits: 10 })).toEqual({
      ok: false,
      issue: 'precision',
      values: { max: 15 },
    })
  })
})

describe('parseInteger', () => {
  it('accepts whole numbers and zero fractions only', () => {
    expect(parseInteger('42')).toEqual({ ok: true, value: 42 })
    expect(parseInteger('٤٢')).toEqual({ ok: true, value: 42 })
    expect(parseInteger('12.0')).toEqual({ ok: true, value: 12 })
    expect(parseInteger('12.5')).toEqual({ ok: false, issue: 'integer' })
    expect(parseInteger('1234567890')).toEqual({
      ok: false,
      issue: 'tooManyDigits',
      values: { max: 9 },
    })
  })
})

function issueOf(schema: z.ZodType, input: unknown) {
  const result = schema.safeParse(input)
  if (result.success) throw new Error('expected a validation failure')
  const [issue] = result.error.issues
  return issue!
}

describe('number schemas', () => {
  it('parses required decimals and reports parser issues with their Validation key', () => {
    const schema = decimalSchema({ min: 0 })
    expect(schema.parse(' 1,250.5 ')).toBe(1250.5)
    expect(issueOf(schema, '')).toMatchObject({ code: 'too_small', origin: 'string' })
    expect(issueOf(schema, '1.2345')).toMatchObject({
      code: 'custom',
      params: { key: 'decimal', values: { scale: 3 } },
    })
    expect(issueOf(schema, 'x')).toMatchObject({ code: 'custom', params: { key: 'number' } })
    expect(issueOf(schema, '-1')).toMatchObject({
      code: 'too_small',
      origin: 'number',
      minimum: 0,
    })
  })

  it('maps empty optional values to null', () => {
    const schema = optionalDecimalSchema({ greaterThan: 0 })
    expect(schema.parse('')).toBeNull()
    expect(schema.parse('0.5')).toBe(0.5)
    expect(issueOf(schema, '0')).toMatchObject({ code: 'too_small', inclusive: false })
  })

  it('checks integer bounds', () => {
    const schema = integerSchema({ min: 1, max: 99 })
    expect(schema.parse('7')).toBe(7)
    expect(issueOf(schema, '100')).toMatchObject({ code: 'too_big', maximum: 99 })
    expect(issueOf(schema, '1.5')).toMatchObject({ params: { key: 'integer' } })
    expect(optionalIntegerSchema().parse('')).toBeNull()
  })
})

describe('numberInputValue', () => {
  it('renders stored numbers as plain parseable text', () => {
    expect(numberInputValue(12.5)).toBe('12.5')
    expect(numberInputValue(1250000)).toBe('1250000')
    expect(numberInputValue(0.0000001)).toBe('0.0000001')
    expect(numberInputValue(null)).toBe('')
    expect(numberInputValue('3.250')).toBe('3.250')
  })
})
