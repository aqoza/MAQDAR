import type { ColumnKind, ContractColumn } from './contract'

/**
 * Turns file cells into the canonical strings of the import contract (dot decimals without
 * grouping, `YYYY-MM-DD`, `true`/`false`, `5;6`), per column kind. Normalizing never rejects:
 * a value that does not parse is passed through (cleaned of invisible marks) for the database to
 * report with its error code, so the error report shows what the file said. The decimal separator
 * and the date order are declared by the user, never guessed.
 *
 * Semantics follow the master-data forms (`src/lib/master-data/numbers.ts`): Arabic-Indic and
 * extended digits, `٫` as the decimal point, `٬` and valid grouping only, `−` as minus, `+5`,
 * exponents and `1 000` refused, trailing fractional zeros irrelevant. Pure module.
 */

export type DecimalSeparator = '.' | ','

export const DATE_ORDERS = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'] as const

export type DateOrder = (typeof DATE_ORDERS)[number]

export type NormalizeOptions = {
  decimalSeparator: DecimalSeparator
  dateOrder: DateOrder
  /** XLSX date serials count from 1904-01-01 (the workbook's `WBProps.date1904`). */
  date1904: boolean
}

export const DEFAULT_NORMALIZE_OPTIONS: NormalizeOptions = {
  decimalSeparator: '.',
  dateOrder: 'YYYY-MM-DD',
  date1904: false,
}

/** An XLSX cell as SheetJS reports it: type, raw value, formatted text. */
export type SheetCell = {
  t: 'b' | 'e' | 'n' | 's' | 'd' | 'z'
  v?: string | number | boolean | Date
  w?: string
}

/** A cell as read from a file: text from CSV, a typed cell from XLSX, or nothing. */
export type RawCell = string | SheetCell | null | undefined

/**
 * Things worth telling the user that the database cannot see:
 * - `numeric_code_cell`: an XLSX code was stored as a number (leading zeros may be lost);
 * - `error_cell`: an XLSX formula error such as `#N/A`;
 * - `ambiguous_decimal`: with the decimal comma declared, a value like `1.5` reads as a dot
 *   decimal (it is passed through and the database accepts it).
 */
export type NormalizeIssue = 'numeric_code_cell' | 'error_cell' | 'ambiguous_decimal'

export type IssueSink = (issue: NormalizeIssue) => void

/* ------------------------------------------------------------------------------------------ */
/* Characters                                                                                  */
/* ------------------------------------------------------------------------------------------ */

const char = (codePoint: number) => String.fromCodePoint(codePoint)
// LRM, RLM, the Arabic letter mark, LRE…RLO, LRI…PDI and the zero-width no-break space (BOM).
// Spelled as code points because they are invisible when written literally.
const INVISIBLE = new RegExp(
  `[${char(0x200e)}${char(0x200f)}${char(0x061c)}${char(0x202a)}-${char(0x202e)}${char(0x2066)}-${char(0x2069)}${char(0xfeff)}]`,
  'g',
)
const HAS_INVISIBLE = new RegExp(INVISIBLE.source)
// No-break, narrow no-break, figure and thin spaces.
const SPACE_LIKE = new RegExp(`[${char(0x00a0)}${char(0x202f)}${char(0x2007)}${char(0x2009)}]`, 'g')
const ARABIC_DECIMAL_SEPARATOR = char(0x066b)
const ARABIC_THOUSANDS_SEPARATOR = char(0x066c)
const MINUS_SIGN = char(0x2212)
// Zero of each digit block mapped to ASCII: Arabic-Indic, extended Arabic-Indic, fullwidth.
const DIGIT_ZEROS = [0x0660, 0x06f0, 0xff10]
const DIGIT_CLASS = DIGIT_ZEROS.map((zero) => `${char(zero)}-${char(zero + 9)}`).join('')
const NON_ASCII_DIGIT = new RegExp(`[${DIGIT_CLASS}]`)
const NON_ASCII_DIGITS = new RegExp(`[${DIGIT_CLASS}]`, 'g')

/** Removes bidi marks and embedding controls (and stray BOMs); they never carry data. */
export function stripInvisible(text: string): string {
  return HAS_INVISIBLE.test(text) ? text.replace(INVISIBLE, '') : text
}

/** Maps Arabic-Indic, extended Arabic-Indic and fullwidth digits to ASCII; nothing else. */
export function toAsciiDigits(text: string): string {
  if (!NON_ASCII_DIGIT.test(text)) return text
  return text.replace(NON_ASCII_DIGITS, (digit) => {
    const code = digit.charCodeAt(0)
    const zero = DIGIT_ZEROS.find((start) => code >= start && code <= start + 9) ?? code
    return String(code - zero)
  })
}

/* ------------------------------------------------------------------------------------------ */
/* Numbers                                                                                     */
/* ------------------------------------------------------------------------------------------ */

const CANONICAL_DECIMAL = /^-?[0-9]+(?:\.[0-9]+)?$/

function canonicalNumber(negative: boolean, integer: string, fraction: string): string {
  // The regexes only run when there are zeros to drop (this is on the per-cell hot path).
  const int = (integer.charCodeAt(0) === 48 ? integer.replace(/^0+(?=\d)/, '') : integer) || '0'
  const frac =
    fraction.charCodeAt(fraction.length - 1) === 48 ? fraction.replace(/0+$/, '') : fraction
  if (int === '0' && frac === '') return '0'
  return `${negative ? '-' : ''}${int}${frac === '' ? '' : `.${frac}`}`
}

/**
 * A JavaScript number (an XLSX numeric cell) as a plain decimal string: 15 significant digits,
 * like Excel shows them (0.1 + 0.2 → `0.3`), never in exponent notation.
 */
export function numberToDecimal(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  if (value === 0) return '0'
  const [mantissa = '0', exponentText = '0'] = Math.abs(value).toPrecision(15).split('e')
  const [integer = '0', fraction = ''] = mantissa.split('.')
  const digits = integer + fraction
  const point = integer.length + Number(exponentText)
  if (point <= 0) return canonicalNumber(value < 0, '0', '0'.repeat(-point) + digits)
  if (point >= digits.length) {
    return canonicalNumber(value < 0, digits + '0'.repeat(point - digits.length), '')
  }
  return canonicalNumber(value < 0, digits.slice(0, point), digits.slice(point))
}

const GROUP_SEPARATORS: Record<DecimalSeparator, readonly string[]> = {
  '.': [',', ARABIC_THOUSANDS_SEPARATOR],
  ',': ['.', ARABIC_THOUSANDS_SEPARATOR, ' ', char(0x00a0), char(0x202f), char(0x2009)],
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The canonical decimal for text in the declared notation, or null when it does not parse. */
function parseLocalizedNumber(text: string, separator: DecimalSeparator): string | null {
  let body = text
  let negative = false
  if (body.startsWith('-')) {
    negative = true
    body = body.slice(1)
  }
  let integer = body
  let fraction = ''
  let decimalMarks = 0
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index]
    if (character === separator || character === ARABIC_DECIMAL_SEPARATOR) decimalMarks += 1
  }
  if (decimalMarks > 1) return null
  if (decimalMarks === 1) {
    const position = Math.max(
      body.lastIndexOf(separator),
      body.lastIndexOf(ARABIC_DECIMAL_SEPARATOR),
    )
    integer = body.slice(0, position)
    fraction = body.slice(position + 1)
    if (!/^\d*$/.test(fraction)) return null
  }
  if (!/^\d*$/.test(integer)) {
    const group = /\D/.exec(integer)?.[0] ?? ''
    if (!GROUP_SEPARATORS[separator].includes(group)) return null
    if (!new RegExp(`^\\d{1,3}(?:${escapeRegExp(group)}\\d{3})+$`).test(integer)) return null
    integer = integer.split(group).join('')
  }
  if (integer === '' && fraction === '') return null
  return canonicalNumber(negative, integer, fraction)
}

/**
 * Decimal and integer text: digits to ASCII, the declared decimal separator (or `٫`) to `.`,
 * thousands separators removed only in a valid grouping (`,` or `٬` with the dot; `.`, `٬` or a
 * space with the comma), leading integer zeros and trailing fractional zeros dropped.
 * `1,5` with the dot, `+5`, `1e5` and `(5)` pass through unchanged for the database to reject.
 */
export function normalizeDecimal(
  raw: string,
  separator: DecimalSeparator = '.',
  report?: IssueSink,
): string {
  let cleaned = toAsciiDigits(stripInvisible(raw)).trim()
  if (cleaned === '') return ''
  if (cleaned.includes(MINUS_SIGN)) cleaned = cleaned.replaceAll(MINUS_SIGN, '-')
  if (separator === '.' && CANONICAL_DECIMAL.test(cleaned)) {
    const negative = cleaned.charCodeAt(0) === 45
    const point = cleaned.indexOf('.')
    const start = negative ? 1 : 0
    return point < 0
      ? canonicalNumber(negative, cleaned.slice(start), '')
      : canonicalNumber(negative, cleaned.slice(start, point), cleaned.slice(point + 1))
  }
  const parsed = parseLocalizedNumber(cleaned, separator)
  if (parsed !== null) return parsed
  if (separator === ',' && CANONICAL_DECIMAL.test(cleaned)) report?.('ambiguous_decimal')
  return cleaned
}

/* ------------------------------------------------------------------------------------------ */
/* Dates                                                                                       */
/* ------------------------------------------------------------------------------------------ */

const DAY_MS = 86_400_000
/** Serial of 9999-12-31 in the 1900 date system. */
const MAX_SERIAL_1900 = 2_958_465
const MAX_SERIAL_1904 = MAX_SERIAL_1900 - 1462

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function isoDate(year: number, month: number, day: number): string | null {
  if (year < 1 || month < 1 || month > 12 || day < 1) return null
  const last = month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] ?? 0)
  if (day > last) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * An XLSX date serial as `YYYY-MM-DD` (the time of day is dropped). In the 1900 system serial 1
 * is 1900-01-01 and serial 60 is Excel's phantom 1900-02-29 (kept as that impossible date, so the
 * database rejects it); later serials are one day off from a plain count. In the 1904 system
 * serial 0 is 1904-01-01. Serials outside 1..9999-12-31 pass through as numbers.
 */
export function serialToIsoDate(serial: number, date1904 = false): string {
  if (!Number.isFinite(serial)) return String(serial)
  const day = Math.floor(serial + 1e-9)
  if (date1904) {
    if (day < 0 || day > MAX_SERIAL_1904) return numberToDecimal(serial)
    return new Date(Date.UTC(1904, 0, 1) + day * DAY_MS).toISOString().slice(0, 10)
  }
  if (day < 1 || day > MAX_SERIAL_1900) return numberToDecimal(serial)
  if (day === 60) return '1900-02-29'
  const epoch = day < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30)
  return new Date(epoch + day * DAY_MS).toISOString().slice(0, 10)
}

// An optional time after the date (Excel CSV exports add one): `13:45`, `0:00:00`, `12:00:00 AM`,
// `12:00 ص`. Without a zone the wall date is kept; with a zone the value passes through.
const TIME_SUFFIX = /[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:\s?(?:[AaPp]\.?[Mm]\.?|[صم]))?$/
const DATE_PARTS = /^(\d{1,4})([-/.])(\d{1,2})\2(\d{1,4})$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * A date in the declared order (`YYYY-MM-DD`, `DD/MM/YYYY` or `MM/DD/YYYY`; separators `-`, `/`
 * or `.`), as `YYYY-MM-DD`. A four-digit year first is read as year-month-day in every order;
 * two-digit years, impossible dates and other shapes pass through.
 */
export function normalizeDate(raw: string, order: DateOrder = 'YYYY-MM-DD'): string {
  const cleaned = toAsciiDigits(stripInvisible(raw)).trim()
  if (cleaned === '') return ''
  // Already canonical: a valid date stays as it is, an impossible one passes through as it is.
  if (ISO_DATE.test(cleaned)) return cleaned
  const match = DATE_PARTS.exec(cleaned.replace(TIME_SUFFIX, ''))
  if (!match) return cleaned
  const [, first = '', , second = '', third = ''] = match
  let parts: readonly [string, string, string] | null = null
  if (first.length === 4 && third.length <= 2) {
    parts = [first, second, third]
  } else if (third.length === 4 && first.length <= 2 && order !== 'YYYY-MM-DD') {
    parts = order === 'DD/MM/YYYY' ? [third, second, first] : [third, first, second]
  }
  if (parts === null) return cleaned
  const [year, month, day] = parts
  return isoDate(Number(year), Number(month), Number(day)) ?? cleaned
}

/* ------------------------------------------------------------------------------------------ */
/* Booleans, weekdays, enums, codes, text                                                      */
/* ------------------------------------------------------------------------------------------ */

const TRUE_WORDS = new Set(['true', 'yes', '1', 'نعم'])
const FALSE_WORDS = new Set(['false', 'no', '0', 'لا'])

/** `true/false`, `yes/no`, `1/0` and `نعم/لا` in any case; anything else passes through. */
export function normalizeBoolean(raw: string): string {
  const cleaned = toAsciiDigits(stripInvisible(raw).normalize('NFKC')).trim()
  const key = cleaned.toLowerCase()
  if (TRUE_WORDS.has(key)) return 'true'
  if (FALSE_WORDS.has(key)) return 'false'
  return cleaned
}

const WEEKDAY_NAMES: Record<string, number> = {
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
  sun: 7,
  sunday: 7,
  الاثنين: 1,
  الإثنين: 1,
  الثلاثاء: 2,
  الأربعاء: 3,
  الاربعاء: 3,
  الخميس: 4,
  الجمعة: 5,
  السبت: 6,
  الأحد: 7,
  الاحد: 7,
}

function weekdayNumber(token: string): number | null {
  if (/^[1-7]$/.test(token)) return Number(token)
  const key = token.toLowerCase()
  if (Object.hasOwn(WEEKDAY_NAMES, key)) return WEEKDAY_NAMES[key] ?? null
  // "والسبت" ("and Saturday").
  if (key.startsWith('و') && Object.hasOwn(WEEKDAY_NAMES, key.slice(1))) {
    return WEEKDAY_NAMES[key.slice(1)] ?? null
  }
  return null
}

/**
 * ISO weekdays as `5;6` (1 = Monday), sorted. Accepts `;`, `,`, `،`, `؛`, `|`, `/` or spaces
 * between days, Postgres array braces, and English or Arabic day names. Duplicates are kept for
 * the database to reject; an unknown token passes the value through. Empty means no weekend days.
 */
export function normalizeWeekdays(raw: string): string {
  const cleaned = toAsciiDigits(stripInvisible(raw).normalize('NFKC'))
    .trim()
    .replace(/^[{[(]\s*|\s*[}\])]$/g, '')
  if (cleaned === '') return ''
  const tokens = cleaned.split(/[\s;,،؛|/&+]+/).filter(Boolean)
  const days: number[] = []
  for (const token of tokens) {
    const day = weekdayNumber(token)
    if (day === null) return cleaned
    days.push(day)
  }
  if (days.length === 0) return ''
  return days.sort((a, b) => a - b).join(';')
}

/**
 * An enum value in any case, with spaces or hyphens for underscores, returned in the contract's
 * spelling (`Two way` → `two_way`, `kg` → `KG`).
 */
export function normalizeEnum(raw: string, values: readonly string[]): string {
  const cleaned = stripInvisible(raw).trim()
  if (cleaned === '') return ''
  const key = cleaned.toLowerCase().replace(/[\s-]+/g, '_')
  return values.find((value) => value.toLowerCase() === key) ?? cleaned
}

/** ISO currency and country codes in capitals (as the master-data forms store them). */
export function normalizeIsoCode(raw: string): string {
  const cleaned = stripInvisible(raw).trim()
  return /^[A-Za-z]+$/.test(cleaned) ? cleaned.toUpperCase() : cleaned
}

/** Codes, part numbers and time zones stay verbatim: only invisible marks and edges go. */
export function normalizeCode(raw: string): string {
  return stripInvisible(raw).trim()
}

/** Free text: invisible marks removed, no-break spaces made plain, edges trimmed. */
export function normalizeText(raw: string): string {
  return stripInvisible(raw).replace(SPACE_LIKE, ' ').trim()
}

/* ------------------------------------------------------------------------------------------ */
/* Cells and rows                                                                              */
/* ------------------------------------------------------------------------------------------ */

type ColumnLike = Pick<ContractColumn, 'kind' | 'enum'>

const NUMERIC_KINDS: ReadonlySet<ColumnKind> = new Set(['integer', 'decimal', 'money'])
const CODE_KINDS: ReadonlySet<ColumnKind> = new Set(['code', 'item_code'])

/** Normalizes one text value for a column. */
export function normalizeString(
  column: ColumnLike,
  raw: string,
  options: NormalizeOptions = DEFAULT_NORMALIZE_OPTIONS,
  report?: IssueSink,
): string {
  switch (column.kind) {
    case 'integer':
    case 'decimal':
    case 'money':
      return normalizeDecimal(raw, options.decimalSeparator, report)
    case 'date':
      return normalizeDate(raw, options.dateOrder)
    case 'boolean':
      return normalizeBoolean(raw)
    case 'weekdays':
      return normalizeWeekdays(raw)
    case 'enum':
      return normalizeEnum(raw, column.enum ?? [])
    case 'currency':
    case 'country':
      return normalizeIsoCode(raw)
    case 'code':
    case 'item_code':
    case 'timezone':
      return normalizeCode(raw)
    case 'text':
      return normalizeText(raw)
  }
}

function dateFromJsDate(value: Date): string {
  if (Number.isNaN(value.getTime())) return ''
  return isoDate(value.getFullYear(), value.getMonth() + 1, value.getDate()) ?? value.toISOString()
}

/** Normalizes an XLSX cell, using the raw number for numbers and dates, the shown text else. */
function normalizeSheetCell(
  column: ColumnLike,
  cell: SheetCell,
  options: NormalizeOptions,
  report?: IssueSink,
): string {
  const { t, v, w } = cell
  if (t === 'z' || v === undefined) {
    return w === undefined ? '' : normalizeString(column, w, options, report)
  }
  if (t === 'e') {
    report?.('error_cell')
    return w ?? '#ERROR'
  }
  if (t === 'b' && typeof v === 'boolean') {
    return column.kind === 'boolean'
      ? String(v)
      : normalizeString(column, w ?? String(v), options, report)
  }
  if (t === 'd' && v instanceof Date) {
    return column.kind === 'date'
      ? dateFromJsDate(v)
      : normalizeString(column, w ?? v.toISOString(), options, report)
  }
  if (typeof v === 'number') {
    if (column.kind === 'date') return serialToIsoDate(v, options.date1904)
    if (NUMERIC_KINDS.has(column.kind)) return numberToDecimal(v)
    if (column.kind === 'boolean') {
      if (v === 1) return 'true'
      if (v === 0) return 'false'
      return numberToDecimal(v)
    }
    if (column.kind === 'weekdays') return normalizeWeekdays(numberToDecimal(v))
    // Codes and text: the text Excel shows keeps custom formats such as leading zeros, unless
    // it is in exponent notation.
    const shown = w !== undefined && !/e[+-]?\d/i.test(w) ? w : numberToDecimal(v)
    if (CODE_KINDS.has(column.kind)) report?.('numeric_code_cell')
    return normalizeString(column, shown, options, report)
  }
  return normalizeString(column, typeof v === 'string' ? v : (w ?? String(v)), options, report)
}

/** Normalizes one cell (CSV text or an XLSX cell) for a column; empty or missing gives ''. */
export function normalizeCell(
  column: ColumnLike,
  raw: RawCell,
  options: NormalizeOptions = DEFAULT_NORMALIZE_OPTIONS,
  report?: IssueSink,
): string {
  if (raw === null || raw === undefined) return ''
  if (typeof raw === 'string') return normalizeString(column, raw, options, report)
  return normalizeSheetCell(column, raw, options, report)
}

/** The text a raw cell shows in a preview, before normalization. */
export function displayRawCell(raw: RawCell): string {
  if (raw === null || raw === undefined) return ''
  if (typeof raw === 'string') return raw
  if (raw.w !== undefined) return raw.w
  if (raw.v instanceof Date) return raw.v.toISOString()
  return raw.v === undefined ? '' : String(raw.v)
}

/** True when a raw cell holds nothing but whitespace or invisible marks. */
export function isBlankCell(raw: RawCell): boolean {
  if (raw === null || raw === undefined) return true
  if (typeof raw === 'string') return stripInvisible(raw).trim() === ''
  if (raw.t === 'z') return raw.w === undefined || stripInvisible(raw.w).trim() === ''
  if (typeof raw.v === 'string') return stripInvisible(raw.v).trim() === ''
  return raw.v === undefined
}

/**
 * How a file's columns feed the contract: for each contract column (in contract order) the
 * source column index, or null when the column is not provided.
 */
export type RowPlan = {
  columns: readonly ColumnLike[]
  sources: readonly (number | null)[]
  options: NormalizeOptions
}

/**
 * One file row as contract cells: null for columns not provided, '' for empty cells, canonical
 * text otherwise. `report` receives issues with the contract column index.
 */
export function normalizeRow(
  plan: RowPlan,
  cells: readonly RawCell[],
  report?: (issue: NormalizeIssue, columnIndex: number) => void,
): (string | null)[] {
  const values: (string | null)[] = new Array<string | null>(plan.columns.length)
  let current = 0
  const sink: IssueSink | undefined = report && ((issue) => report(issue, current))
  for (let index = 0; index < plan.columns.length; index += 1) {
    const source = plan.sources[index]
    const column = plan.columns[index]
    if (source === null || source === undefined || column === undefined) {
      values[index] = null
      continue
    }
    current = index
    values[index] = normalizeCell(column, cells[source], plan.options, sink)
  }
  return values
}
