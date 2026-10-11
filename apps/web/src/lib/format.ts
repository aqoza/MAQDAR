/**
 * Display helpers for master data. They take a formatter (next-intl's `getFormatter()` /
 * `useFormatter()`, or anything with the same `number` and `dateTime` methods), so the request's
 * locale and numbering system apply. Pure module, so Vitest can load it.
 */

export type NumberFormatterLike = {
  number(value: number, options?: Intl.NumberFormatOptions): string
}

export type DateFormatterLike = {
  dateTime(value: Date, options?: Intl.DateTimeFormatOptions): string
}

/** Placeholder for empty cells. */
export const EMPTY = '—'

function isCurrencyCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value)
}

/**
 * Money with its ISO code (`SAR 1,234.50`, `KWD 1.250`): Intl picks the currency's own fraction
 * digits, so KWD, BHD, OMR and JOD show 3 decimals. Without a valid currency the amount shows with
 * up to 3 decimals.
 */
export function formatMoney(
  format: NumberFormatterLike,
  value: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY
  if (!isCurrencyCode(currency)) return format.number(value, { maximumFractionDigits: 3 })
  try {
    return format.number(value, { style: 'currency', currency, currencyDisplay: 'code' })
  } catch {
    // An ISO-shaped code the runtime does not know.
    return `${currency} ${format.number(value, { maximumFractionDigits: 3 })}`
  }
}

/** A quantity or other decimal with up to `maximumFractionDigits` (3) decimals. */
export function formatDecimal(
  format: NumberFormatterLike,
  value: number | null | undefined,
  maximumFractionDigits = 3,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY
  return format.number(value, { maximumFractionDigits })
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * A date column (`YYYY-MM-DD`, no time zone) formatted as that calendar day. It is parsed as UTC
 * midnight and formatted with `timeZone: 'UTC'`, so the organization's time zone never shifts it.
 */
export function formatDateOnly(
  format: DateFormatterLike,
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' },
): string {
  const match = value ? DATE_ONLY.exec(value) : null
  if (!match) return value ? value : EMPTY
  const [, year, month, day] = match
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  if (Number.isNaN(date.getTime())) return value ?? EMPTY
  return format.dateTime(date, { ...options, timeZone: 'UTC' })
}

export type NamedRow = { name_en?: string | null; name_ar?: string | null }

export type DisplayName = {
  /** The name to show first in this locale. */
  primary: string
  primaryLang: 'en' | 'ar'
  /** The other name, when both exist. */
  secondary: string | null
  secondaryLang: 'en' | 'ar'
}

/** Arabic interfaces show the Arabic name first when there is one; English shows English first. */
export function displayName(row: NamedRow, locale: string): DisplayName {
  const english = row.name_en?.trim() || null
  const arabic = row.name_ar?.trim() || null
  const arabicFirst = locale.startsWith('ar') && arabic !== null
  if (arabicFirst) {
    return { primary: arabic, primaryLang: 'ar', secondary: english, secondaryLang: 'en' }
  }
  return {
    primary: english ?? arabic ?? EMPTY,
    primaryLang: english === null && arabic !== null ? 'ar' : 'en',
    secondary: english !== null ? arabic : null,
    secondaryLang: 'ar',
  }
}
