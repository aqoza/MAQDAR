/**
 * CSV writer for the downloadable error report. Spreadsheet-safe by construction: a UTF-8
 * byte-order mark (so Excel reads Arabic correctly), every field in double quotes with inner
 * quotes doubled, CRLF line endings, and formula injection neutralized: a field whose first
 * visible character is `=`, `+`, `-`, `@`, a tab, CR or LF, or their full-width forms
 * `＝ ＋ － ＠`, gets a leading `'` (OWASP "CSV Injection"). Plain numbers such as `-5` stay as they
 * are; they cannot carry a formula. Streams: rows go in as an (async) iterable, text comes out
 * in pieces of about 64 KB, so a 10,000-row report never sits in memory twice. Pure module
 * (web streams and TextEncoder only), usable from route handlers on Workers and in Node.
 */

export type ReportField = string | number | boolean | null | undefined

export const CSV_BOM = '﻿'
export const CSV_LINE_END = '\r\n'

const char = (codePoint: number) => String.fromCodePoint(codePoint)
// Characters spreadsheets read as the start of a formula, including the full-width forms that
// some applications fold to ASCII.
const FORMULA_STARTS = new Set([
  '=',
  '+',
  '-',
  '@',
  '\t',
  '\r',
  '\n',
  char(0xff1d),
  char(0xff0b),
  char(0xff0d),
  char(0xff20),
])
// Invisible or blank characters an attacker can put in front of a trigger (space, no-break space,
// bidi marks, zero-width characters, BOM). Tab, CR and LF are triggers themselves.
const LEADING_IGNORABLE = new RegExp(
  `^[ ${char(0x00a0)}${char(0x2000)}-${char(0x200f)}${char(0x2028)}-${char(0x202f)}${char(0x205f)}-${char(0x206f)}${char(0x061c)}${char(0x3000)}${char(0xfeff)}]+`,
)
const PLAIN_NUMBER = /^-?[0-9]+(?:\.[0-9]+)?$/

/** Prefixes `'` when a spreadsheet could read the value as a formula. */
export function neutralizeFormula(value: string): string {
  if (value === '' || PLAIN_NUMBER.test(value)) return value
  const visible = value.replace(LEADING_IGNORABLE, '')
  return FORMULA_STARTS.has(visible.charAt(0)) ? `'${value}` : value
}

function fieldText(value: ReportField): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  return String(value)
}

/** One field: neutralized, quoted, inner quotes doubled. */
export function csvField(value: ReportField): string {
  return `"${neutralizeFormula(fieldText(value)).replaceAll('"', '""')}"`
}

/** One line: fields joined by commas, ended by CRLF. */
export function csvLine(fields: readonly ReportField[]): string {
  return `${fields.map(csvField).join(',')}${CSV_LINE_END}`
}

export type CsvReportOptions = {
  /** Start with a UTF-8 byte-order mark (default true). */
  bom?: boolean
  /** Characters per yielded piece (default 64 KB); a piece always ends at a line end. */
  pieceChars?: number
}

/** The report as text pieces: BOM and header first, then the rows. */
export function* csvReport(
  header: readonly ReportField[],
  rows: Iterable<readonly ReportField[]>,
  options: CsvReportOptions = {},
): Generator<string, void, undefined> {
  const limit = options.pieceChars ?? 65_536
  let piece = `${options.bom === false ? '' : CSV_BOM}${csvLine(header)}`
  for (const row of rows) {
    piece += csvLine(row)
    if (piece.length >= limit) {
      yield piece
      piece = ''
    }
  }
  if (piece !== '') yield piece
}

/** The same, from rows that arrive asynchronously (keyset pages from the database). */
export async function* csvReportAsync(
  header: readonly ReportField[],
  rows: AsyncIterable<readonly ReportField[]> | Iterable<readonly ReportField[]>,
  options: CsvReportOptions = {},
): AsyncGenerator<string, void, undefined> {
  const limit = options.pieceChars ?? 65_536
  let piece = `${options.bom === false ? '' : CSV_BOM}${csvLine(header)}`
  for await (const row of rows) {
    piece += csvLine(row)
    if (piece.length >= limit) {
      yield piece
      piece = ''
    }
  }
  if (piece !== '') yield piece
}

/**
 * A byte stream of the report for a `Response` body. Rows are pulled only as the client reads,
 * and cancelling the download stops the source iterator.
 */
export function csvReportStream(
  header: readonly ReportField[],
  rows: AsyncIterable<readonly ReportField[]> | Iterable<readonly ReportField[]>,
  options: CsvReportOptions = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const pieces = csvReportAsync(header, rows, options)
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await pieces.next()
        if (next.done) controller.close()
        else controller.enqueue(encoder.encode(next.value))
      } catch (error) {
        controller.error(error)
      }
    },
    async cancel() {
      await pieces.return(undefined)
    },
  })
}
