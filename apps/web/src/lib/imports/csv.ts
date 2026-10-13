import Papa from 'papaparse'

/**
 * Delimited text (CSV, TSV, TXT) as records, with Papa Parse 5.7.0's core parser fed slice by
 * slice: each slice is parsed with the unfinished last record carried into the next (what Papa's
 * own streamers do), so a 50 MB file is parsed without ever being one string and the caller
 * pulls records at its own pace. The delimiter (comma, semicolon or tab) is detected from a
 * sample unless the user chose one. Pure module (no DOM), used by the parse worker and the
 * main-thread fallback.
 */

export const DELIMITERS = [',', ';', '\t'] as const

export type Delimiter = (typeof DELIMITERS)[number]

export type DelimiterChoice = 'auto' | Delimiter

export type Newline = '\r\n' | '\n' | '\r'

export type Dialect = { delimiter: Delimiter; newline: Newline }

export function isDelimiterChoice(value: unknown): value is DelimiterChoice {
  return value === 'auto' || (DELIMITERS as readonly unknown[]).includes(value)
}

/**
 * The dialect of a text sample (the start of the file). `detected` is false when the delimiter
 * could not be told (a single-column file, say); the comma is used then.
 */
export function detectDialect(
  sample: string,
  choice: DelimiterChoice = 'auto',
): Dialect & { detected: boolean } {
  // Whole lines only, and blank lines skipped: Papa needs an average above ~2 fields per line, which
  // a cut-off last line or a trailing blank line can pull a two-column file under.
  const lastNewline = Math.max(sample.lastIndexOf('\n'), sample.lastIndexOf('\r'))
  const lines = lastNewline > 0 ? sample.slice(0, lastNewline + 1) : sample
  const result = Papa.parse<string[]>(lines, {
    preview: 50,
    skipEmptyLines: true,
    delimiter: choice === 'auto' ? '' : choice,
    delimitersToGuess: [...DELIMITERS],
  })
  const newline: Newline =
    (['\r\n', '\n', '\r'] as const).find((value) => value === result.meta.linebreak) ?? '\n'
  if (choice !== 'auto') return { delimiter: choice, newline, detected: true }
  const guessed = DELIMITERS.find((value) => value === result.meta.delimiter)
  const failed = result.errors.some((error) => error.code === 'UndetectableDelimiter')
  return guessed && !failed
    ? { delimiter: guessed, newline, detected: true }
    : { delimiter: ',', newline, detected: false }
}

export type CsvError = {
  /** Papa's code: `MissingQuotes`, `InvalidQuotes`, or ours, `RecordTooLong`. */
  code: string
  message: string
  /** 0-based record index (the header is record 0). */
  record: number
}

/** A record that has not ended after this many characters is a quote left open. */
export const MAX_RECORD_CHARS = 1 << 20

type CoreResult = {
  data: string[][]
  errors: { code?: string; message?: string; row?: number }[]
  meta: { cursor: number }
}

type CoreParser = { parse(input: string, baseIndex: number, ignoreLastRow: boolean): CoreResult }

function coreParser(dialect: Dialect): CoreParser {
  // Papa.Parser is the synchronous core behind Papa.parse (exported, typed in @types/papaparse).
  const Parser = Papa.Parser as unknown as new (config: Papa.ParseConfig) => CoreParser
  return new Parser({
    delimiter: dialect.delimiter,
    newline: dialect.newline,
    quoteChar: '"',
    escapeChar: '"',
  })
}

export class CsvRecordError extends Error {
  constructor(readonly detail: CsvError) {
    super(detail.message)
    this.name = 'CsvRecordError'
  }
}

/**
 * Records of delimited text arriving in pieces (any sizes). Parse errors that Papa recovers from
 * are passed to `onError` and the records still come out; an unterminated quote that swallows
 * more than `MAX_RECORD_CHARS` throws `CsvRecordError`.
 */
export async function* csvRecords(
  pieces: AsyncIterable<string> | Iterable<string>,
  dialect: Dialect,
  onError?: (error: CsvError) => void,
): AsyncGenerator<string[], void, undefined> {
  let pending = ''
  let record = 0

  function* emit(result: CoreResult): Generator<string[], void, undefined> {
    // Errors of the unfinished last record come again when it is parsed whole.
    for (const error of result.errors) {
      if ((error.row ?? 0) >= result.data.length) continue
      onError?.({
        code: error.code ?? 'ParseError',
        message: error.message ?? 'Malformed CSV',
        record: record + (error.row ?? 0),
      })
    }
    for (const row of result.data) {
      record += 1
      yield row
    }
  }

  for await (const piece of pieces) {
    const input = pending + piece
    const result = coreParser(dialect).parse(input, 0, true)
    yield* emit(result)
    pending = input.substring(result.meta.cursor)
    if (pending.length > MAX_RECORD_CHARS) {
      throw new CsvRecordError({
        code: 'RecordTooLong',
        message: `Record ${record} does not end; a quoted field is probably not closed`,
        record,
      })
    }
  }
  if (pending !== '') yield* emit(coreParser(dialect).parse(pending, 0, false))
}
