import { z } from 'zod'

/**
 * Number input for master-data forms. Users type Latin digits, Arabic-Indic digits (٠–٩) or
 * extended Arabic-Indic digits (۰–۹), with `.` or the Arabic decimal separator `٫`, and may group
 * thousands with `,` (or `٬`), but only in a valid grouping (1,234,567.5; never 1,23). Values that
 * Postgres would round silently (more fractional digits than the column scale) or that a JavaScript
 * number cannot hold exactly (more than 15 significant digits) are refused rather than altered.
 * Money and quantities are numeric(18,3): 12 integer digits + 3 fractional digits = 15.
 *
 * Pure module (zod only), so Vitest can load it.
 */

export const MAX_SIGNIFICANT_DIGITS = 15

/** Validation message keys these helpers report (all exist in the Validation namespace). */
export type NumberIssue = 'number' | 'integer' | 'decimal' | 'tooManyDigits' | 'precision'

export type ParsedNumber =
  { ok: true; value: number } | { ok: false; issue: NumberIssue; values?: Record<string, number> }

export type DecimalFormat = {
  /** Fractional digits the column keeps (numeric(18,3) → 3). */
  scale?: number
  /** Integer digits the column keeps (numeric(18,3) → 15, capped here at 12 for exactness). */
  integerDigits?: number
}

const DIGIT_ZERO = { arabicIndic: 0x0660, extended: 0x06f0 }
const char = (codePoint: number) => String.fromCodePoint(codePoint)
// Code points are spelled out because these characters are invisible when written literally:
// LRM, RLM, the Arabic letter mark, LRE…RLO (U+202A–U+202E) and LRI…PDI (U+2066–U+2069).
const BIDI_CONTROLS = new RegExp(
  `[${char(0x200e)}${char(0x200f)}${char(0x061c)}${char(0x202a)}-${char(0x202e)}${char(0x2066)}-${char(0x2069)}]`,
  'g',
)
const ARABIC_DECIMAL_SEPARATOR = char(0x066b)
const ARABIC_THOUSANDS_SEPARATOR = char(0x066c)
const MINUS_SIGN = char(0x2212)

/**
 * Maps Arabic-Indic and extended digits to ASCII, `٫` to `.`, `٬` to `,`, `−` (U+2212) to `-`,
 * removes bidi control characters and trims. Everything else is left for the parser to judge.
 */
export function normalizeDigits(input: string): string {
  let result = ''
  for (const character of input.replace(BIDI_CONTROLS, '')) {
    const code = character.codePointAt(0) ?? 0
    if (code >= DIGIT_ZERO.arabicIndic && code <= DIGIT_ZERO.arabicIndic + 9) {
      result += String(code - DIGIT_ZERO.arabicIndic)
    } else if (code >= DIGIT_ZERO.extended && code <= DIGIT_ZERO.extended + 9) {
      result += String(code - DIGIT_ZERO.extended)
    } else if (character === ARABIC_DECIMAL_SEPARATOR) {
      result += '.'
    } else if (character === ARABIC_THOUSANDS_SEPARATOR) {
      result += ','
    } else if (character === MINUS_SIGN) {
      result += '-'
    } else {
      result += character
    }
  }
  return result.trim()
}

// Optional minus, then either a validly grouped integer part or plain digits (possibly none, as in
// ".5"), then an optional fraction (possibly empty, as in "5.").
const NUMBER_PATTERN = /^(-)?(\d{1,3}(?:,\d{3})+|\d*)(?:\.(\d*))?$/

/** Parses one decimal value. Trailing fractional zeros never count against the scale. */
export function parseDecimal(input: string, format: DecimalFormat = {}): ParsedNumber {
  const scale = format.scale ?? 3
  const integerDigits = format.integerDigits ?? 12
  const text = normalizeDigits(input)
  const match = NUMBER_PATTERN.exec(text)
  if (!match) return { ok: false, issue: 'number' }
  const [, minus = '', groupedInteger = '', rawFraction = ''] = match
  const integer = groupedInteger.replaceAll(',', '')
  if (integer === '' && rawFraction === '') return { ok: false, issue: 'number' }

  const significantInteger = integer.replace(/^0+/, '')
  const fraction = rawFraction.replace(/0+$/, '')
  if (fraction.length > scale) {
    return scale === 0
      ? { ok: false, issue: 'integer' }
      : { ok: false, issue: 'decimal', values: { scale } }
  }
  if (significantInteger.length > integerDigits) {
    return { ok: false, issue: 'tooManyDigits', values: { max: integerDigits } }
  }
  const significant =
    significantInteger.length > 0
      ? significantInteger.length + fraction.length
      : fraction.replace(/^0+/, '').length
  if (significant > MAX_SIGNIFICANT_DIGITS) {
    return { ok: false, issue: 'precision', values: { max: MAX_SIGNIFICANT_DIGITS } }
  }

  const value = Number(`${minus}${significantInteger || '0'}.${fraction || '0'}`)
  // -0 would print as "0" anyway; keep comparisons and JSON simple.
  return { ok: true, value: Object.is(value, -0) ? 0 : value }
}

/** Parses a whole number (a fraction of only zeros, as in "12.0", is accepted). */
export function parseInteger(input: string, maxDigits = 9): ParsedNumber {
  return parseDecimal(input, { scale: 0, integerDigits: maxDigits })
}

/* ------------------------------------------------------------------------------------------ */
/* Zod schemas over form strings                                                               */
/* ------------------------------------------------------------------------------------------ */

export type NumberBounds = {
  /** Inclusive lower bound (reported as Validation.minValue). */
  min?: number
  /** Exclusive lower bound (reported as Validation.greaterThan). */
  greaterThan?: number
  /** Inclusive upper bound (reported as Validation.maxValue). */
  max?: number
}

function boundedNumber(bounds: NumberBounds) {
  let schema = z.number()
  if (bounds.min !== undefined) schema = schema.min(bounds.min)
  if (bounds.greaterThan !== undefined) schema = schema.gt(bounds.greaterThan)
  if (bounds.max !== undefined) schema = schema.max(bounds.max)
  return schema
}

type Parser = (text: string) => ParsedNumber

/** Parses or records a custom issue whose params name the Validation key (see validation.ts). */
function parseOrIssue(parse: Parser, text: string, ctx: z.RefinementCtx): number {
  const parsed = parse(text)
  if (parsed.ok) return parsed.value
  ctx.addIssue({
    code: 'custom',
    message: parsed.issue,
    params: { key: parsed.issue, values: parsed.values },
  })
  return z.NEVER
}

function requiredNumber(parse: Parser, bounds: NumberBounds) {
  return z
    .string()
    .trim()
    .min(1)
    .transform((text, ctx) => parseOrIssue(parse, text, ctx))
    .pipe(boundedNumber(bounds))
}

function optionalNumber(parse: Parser, bounds: NumberBounds) {
  return z
    .string()
    .trim()
    .transform((text, ctx) => (text === '' ? null : parseOrIssue(parse, text, ctx)))
    .pipe(boundedNumber(bounds).nullable())
}

/** A required decimal form field; '' reports `required`. */
export function decimalSchema(options: DecimalFormat & NumberBounds = {}) {
  return requiredNumber((text) => parseDecimal(text, options), options)
}

/** An optional decimal form field; '' becomes null. */
export function optionalDecimalSchema(options: DecimalFormat & NumberBounds = {}) {
  return optionalNumber((text) => parseDecimal(text, options), options)
}

export type IntegerOptions = NumberBounds & { maxDigits?: number }

/** A required whole-number form field. */
export function integerSchema(options: IntegerOptions = {}) {
  return requiredNumber((text) => parseInteger(text, options.maxDigits), options)
}

/** An optional whole-number form field; '' becomes null. */
export function optionalIntegerSchema(options: IntegerOptions = {}) {
  return optionalNumber((text) => parseInteger(text, options.maxDigits), options)
}

/**
 * The text a number input starts with when editing a stored value: plain digits with `.`, no
 * grouping, so it parses back unchanged in every locale.
 */
export function numberInputValue(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // toString switches to exponent notation outside 1e-7…1e21; fixed digits keep it parseable.
    const text = String(value)
    if (!/e/i.test(text)) return text
    return value.toFixed(10).replace(/\.?0+$/, '')
  }
  if (typeof value === 'string') return value
  return ''
}
