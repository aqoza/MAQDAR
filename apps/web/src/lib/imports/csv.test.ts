import { describe, expect, it } from 'vitest'
import {
  CsvRecordError,
  MAX_RECORD_CHARS,
  csvRecords,
  detectDialect,
  isDelimiterChoice,
  type CsvError,
  type Dialect,
} from './csv'

async function collect(pieces: Iterable<string>, dialect: Dialect, errors?: CsvError[]) {
  const records: string[][] = []
  for await (const record of csvRecords(pieces, dialect, (error) => errors?.push(error))) {
    records.push(record)
  }
  return records
}

/** Every way of cutting a text into pieces of `size` characters. */
function slices(text: string, size: number): string[] {
  const pieces: string[] = []
  for (let start = 0; start < text.length; start += size)
    pieces.push(text.slice(start, start + size))
  return pieces
}

describe('detectDialect', () => {
  it('detects comma, semicolon and tab, and the line ending', () => {
    expect(detectDialect('a,b,c\r\n1,2,3\r\n')).toEqual({
      delimiter: ',',
      newline: '\r\n',
      detected: true,
    })
    expect(detectDialect('a;b;c\n1,5;2;3\n')).toEqual({
      delimiter: ';',
      newline: '\n',
      detected: true,
    })
    expect(detectDialect('a\tb\tc\r\n1\t2\t3')).toEqual({
      delimiter: '\t',
      newline: '\r\n',
      detected: true,
    })
    expect(detectDialect('item;qty\nP-1;1,5\nP-2;2,25\n').delimiter).toBe(';')
  })

  it('falls back to the comma for a single column and honours a choice', () => {
    expect(detectDialect('item_code\nP-1\nP-2\n')).toEqual({
      delimiter: ',',
      newline: '\n',
      detected: false,
    })
    expect(detectDialect('a,b;c\n1,2;3\n', ';')).toEqual({
      delimiter: ';',
      newline: '\n',
      detected: true,
    })
  })

  it('accepts the supported choices only', () => {
    expect([',', ';', '\t', 'auto'].every(isDelimiterChoice)).toBe(true)
    expect(isDelimiterChoice('|')).toBe(false)
  })
})

describe('csvRecords', () => {
  const text =
    'item_code,name_en,note\r\n' +
    'P-1,"Filter, oil","He said ""hi""\r\nthen left"\r\n' +
    'P-2,فلتر زيت,\r\n' +
    '\r\n' +
    'P-3,"",x\r\n'
  const expected = [
    ['item_code', 'name_en', 'note'],
    ['P-1', 'Filter, oil', 'He said "hi"\r\nthen left'],
    ['P-2', 'فلتر زيت', ''],
    [''],
    ['P-3', '', 'x'],
  ]
  const dialect: Dialect = { delimiter: ',', newline: '\r\n' }

  it('parses quotes, embedded newlines and blank lines', async () => {
    expect(await collect([text], dialect)).toEqual(expected)
  })

  it('gives the same records however the text is sliced', async () => {
    for (const size of [1, 2, 3, 5, 7, 16, 64]) {
      expect(await collect(slices(text, size), dialect), `size ${size}`).toEqual(expected)
    }
  })

  it('keeps a last record without a line ending', async () => {
    expect(await collect(slices('a;b\n1;2', 3), { delimiter: ';', newline: '\n' })).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(await collect([], dialect)).toEqual([])
    expect(await collect([''], dialect)).toEqual([])
  })

  it('reads tab-delimited Unicode Text', async () => {
    const records = await collect(slices('item_code\tname_ar\r\nP-1\tفلتر\r\n', 4), {
      delimiter: '\t',
      newline: '\r\n',
    })
    expect(records).toEqual([
      ['item_code', 'name_ar'],
      ['P-1', 'فلتر'],
    ])
  })

  it('reports malformed quotes with the record index, however the text is sliced', async () => {
    const lf: Dialect = { delimiter: ',', newline: '\n' }
    for (const size of [1, 4, 100]) {
      const errors: CsvError[] = []
      const records = await collect(slices('a,b\n1,2\n3,"open\n4,5\n', size), lf, errors)
      expect(records).toEqual([
        ['a', 'b'],
        ['1', '2'],
        ['3', 'open\n4,5\n'],
      ])
      expect(errors.map((error) => [error.code, error.record])).toEqual([['MissingQuotes', 2]])
    }
    const errors: CsvError[] = []
    await collect(['a,b\n1,"x"y,2\n'], lf, errors)
    expect(errors.map((error) => [error.code, error.record])).toEqual([
      ['InvalidQuotes', 1],
      ['MissingQuotes', 1],
    ])
  })

  it('refuses a quote left open for more than a record can hold', async () => {
    const pieces = [
      'a,b\n1,"never closed',
      ...Array.from({ length: 3 }, () => 'x'.repeat(MAX_RECORD_CHARS / 2)),
    ]
    await expect(collect(pieces, dialect)).rejects.toBeInstanceOf(CsvRecordError)
  })
})
