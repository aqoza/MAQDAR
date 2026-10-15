import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { chunkBody } from './chunks'
import { getEntity, type EntityName } from './contract'
import { autoMap, sourceIndexes } from './mapping'
import {
  ImportFileError,
  createWorkerHandler,
  inspectFile,
  normalizePreview,
  parseChunks,
  type ChunkEvent,
  type FileLike,
  type ParseRequest,
  type ParseSummary,
  type WorkbookCacheRef,
  type WorkerResponse,
} from './parse'
import { loadSheetJs } from './xlsx'

const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0))

async function drain(generator: AsyncGenerator<ChunkEvent, ParseSummary, undefined>) {
  const events: ChunkEvent[] = []
  for (;;) {
    const next = await generator.next()
    if (next.done) return { events, summary: next.value }
    events.push(next.value)
  }
}

const rowsOf = (events: ChunkEvent[]) =>
  events.flatMap((event) => JSON.parse(chunkBody(event.chunk)) as unknown[][])

function request(
  entity: EntityName,
  header: string[],
  overrides: Partial<ParseRequest> = {},
): ParseRequest {
  return {
    entity,
    sources: sourceIndexes(entity, autoMap(entity, header)),
    normalize: { decimalSeparator: '.', dateOrder: 'YYYY-MM-DD', date1904: false },
    ...overrides,
  }
}

async function xlsxFile(name: string, rows: unknown[][], date1904 = false): Promise<File> {
  const XLSX = await loadSheetJs()
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Data')
  book.Workbook = { WBProps: { date1904 } }
  return new File([XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer], name)
}

describe('inspectFile', () => {
  it('reads a Windows-1256 CSV: encoding, delimiter, header, preview and hash', async () => {
    // "فلتر" (filter) in Windows-1256.
    const bytes = new Uint8Array([
      ...ascii('item_code;name_ar;unit_cost\r\nP-1;'),
      0xdd,
      0xe1,
      0xca,
      0xd1,
      ...ascii(';1,5\r\nP-2;;2\r\n'),
    ])
    const result = await inspectFile(new File([bytes], 'items.csv'))
    expect(result).toMatchObject({
      name: 'items.csv',
      size: bytes.length,
      format: 'csv',
      encoding: { encoding: 'windows-1256', source: 'fallback' },
      dialect: { delimiter: ';', newline: '\r\n', detected: true },
      header: ['item_code', 'name_ar', 'unit_cost'],
      preview: [
        ['P-1', 'فلتر', '1,5'],
        ['P-2', '', '2'],
      ],
      rowCount: null,
      problems: [],
      issues: {},
    })
    expect(result.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
  })

  it('reads UTF-16LE Unicode Text and honours an encoding override', async () => {
    const text = 'item_code\tname_ar\r\nP-1\tمرشح\r\n'
    const utf16 = new Uint8Array(2 + text.length * 2)
    utf16.set([0xff, 0xfe])
    for (let index = 0; index < text.length; index += 1) {
      const unit = text.charCodeAt(index)
      utf16.set([unit & 0xff, unit >> 8], 2 + index * 2)
    }
    const file = new File([utf16], 'export.txt')
    const result = await inspectFile(file)
    expect(result.encoding?.encoding).toBe('utf-16le')
    expect(result.dialect?.delimiter).toBe('\t')
    expect(result.header).toEqual(['item_code', 'name_ar'])
    expect(result.preview).toEqual([['P-1', 'مرشح']])
    const wrong = await inspectFile(file, { encoding: 'windows-1256' })
    expect(wrong.encoding?.source).toBe('override')
    expect(wrong.header).not.toEqual(['item_code', 'name_ar'])
  })

  it('cleans header names and flags missing headers and replacement characters', async () => {
    const bom = new File(['﻿‏item_code ,name en\n1,2\n'], 'items.csv')
    expect((await inspectFile(bom)).header).toEqual(['item_code', 'name en'])
    const blank = await inspectFile(new File([',,\nP-1,a,b\n'], 'items.csv'))
    expect(blank.problems).toEqual([{ code: 'no_header' }])
    const bad = await inspectFile(new File([new Uint8Array([0x61, 0x0a, 0xff, 0x0a])], 'x.csv'), {
      encoding: 'utf-8',
    })
    expect(bad.issues.replacement_characters?.count).toBe(1)
  })

  it('stops the preview at 20 rows', async () => {
    const lines = ['item_code', ...Array.from({ length: 50 }, (_, index) => `P-${index + 1}`)]
    const result = await inspectFile(new File([lines.join('\n')], 'items.csv'))
    expect(result.preview).toHaveLength(20)
    expect(result.preview[19]).toEqual(['P-20'])
  })

  it('reads an XLSX workbook: sheets, date system, header, preview and rows', async () => {
    const file = await xlsxFile(
      'items.xlsx',
      [
        ['item_code', 'introduced_on'],
        [
          { t: 'n', v: 7, z: '000' },
          { t: 'n', v: 42369, z: 'yyyy-mm-dd' },
        ],
        ['P-2', null],
        [null, null],
      ],
      true,
    )
    const cache: WorkbookCacheRef = { current: null }
    const result = await inspectFile(file, {}, cache)
    expect(result).toMatchObject({
      format: 'xlsx',
      encoding: null,
      dialect: null,
      sheets: [{ name: 'Data', hidden: false }],
      sheet: 'Data',
      date1904: true,
      header: ['item_code', 'introduced_on'],
      rowCount: 2,
      problems: [],
    })
    expect(result.preview[0]?.[0]).toEqual({ t: 'n', v: 7, w: '007' })
    expect(cache.current?.sheet).toBe('Data')
  })

  it('refuses unsupported, empty and oversized files', async () => {
    await expect(inspectFile(new File(['x'], 'items.json'))).rejects.toMatchObject({
      code: 'unsupported_type',
    })
    await expect(inspectFile(new File([], 'items.csv'))).rejects.toMatchObject({
      code: 'empty_file',
    })
    const huge = { name: 'demand.csv', size: 50_000_001 } as FileLike
    await expect(inspectFile(huge)).rejects.toMatchObject({
      code: 'too_large',
      detail: { max: 50_000_000 },
    })
    const bigBook = { name: 'b.xlsx', size: 20_000_001 } as FileLike
    await expect(inspectFile(bigBook)).rejects.toBeInstanceOf(ImportFileError)
    await expect(inspectFile(new File(['not a zip'], 'b.xlsx'))).rejects.toMatchObject({
      code: 'unreadable',
    })
  })
})

describe('normalizePreview', () => {
  it('shows staged values and preview warnings', () => {
    const header = ['item_code', 'name_en']
    const { rows, issues } = normalizePreview(
      'brands',
      sourceIndexes('brands', {
        brand_code: { index: 0, source: 'manual' },
        name_en: { index: 1, source: 'name' },
      }),
      { decimalSeparator: '.', dateOrder: 'YYYY-MM-DD', date1904: false },
      [[{ t: 'n', v: 12, w: '012' }, ' Bosch ']],
    )
    expect(header).toHaveLength(2)
    expect(rows).toEqual([['012', 'Bosch', null, null, null, null]])
    expect(issues.numeric_code_cell).toEqual({
      count: 1,
      examples: [{ row: 1, column: 'brand_code', value: '012' }],
    })
  })
})

describe('parseChunks', () => {
  const demandHeader = ['item_code', 'location_code', 'demand_date', 'quantity']
  const demandCsv =
    'item_code;location_code;demand_date;quantity\r\n' +
    'P-1;RUH;05/01/2024;١٬٢٣٤٫٥\r\n' +
    'P-2;RUH;06/01/2024;2,5\r\n' +
    ';;;\r\n' +
    'P-3;JED;07/01/2024;0\r\n' +
    'P-4;JED;08/01/2024;3\r\n' +
    ';;;\r\n' +
    '\r\n'
  const demandRequest = (overrides: Partial<ParseRequest> = {}) =>
    request('demand_history', demandHeader, {
      normalize: { decimalSeparator: ',', dateOrder: 'DD/MM/YYYY', date1904: false },
      ...overrides,
    })

  it('streams normalized rows in contiguous chunks', async () => {
    const file = new File([demandCsv], 'demand_history.csv')
    const { events, summary } = await drain(
      parseChunks(file, demandRequest({ limits: { maxRows: 2 } })),
    )
    expect(events.map((event) => [event.chunk.firstRow, event.chunk.lastRow])).toEqual([
      [1, 2],
      [3, 4],
      [5, 5],
    ])
    expect(rowsOf(events)).toEqual([
      [1, 'P-1', 'RUH', '2024-01-05', '1234.5', null, null],
      [2, 'P-2', 'RUH', '2024-01-06', '2.5', null, null],
      [3, '', '', '', '', null, null],
      [4, 'P-3', 'JED', '2024-01-07', '0', null, null],
      [5, 'P-4', 'JED', '2024-01-08', '3', null, null],
    ])
    expect(summary).toEqual({ rowsTotal: 5, trailingBlankRows: 2, issues: {} })
    expect(events.at(-1)?.progress).toBe(1)
    expect(events.at(-1)?.rowsRead).toBe(5)
  })

  it('resumes from a later row with the same numbering', async () => {
    const file = new File([demandCsv], 'demand_history.csv')
    const { events, summary } = await drain(parseChunks(file, demandRequest({ startRow: 4 })))
    expect(rowsOf(events).map((row) => row[0])).toEqual([4, 5])
    expect(summary.rowsTotal).toBe(5)
  })

  it('reads the same rows from 1 MB slices of a large file', async () => {
    const lines = ['item_code,location_code,demand_date,quantity']
    for (let row = 1; row <= 60_000; row += 1) lines.push(`P-${row},RUH-01,2024-01-05,${row % 7}`)
    const file = new File([lines.join('\n')], 'demand_history.csv')
    expect(file.size).toBeGreaterThan(1 << 20)
    const { events, summary } = await drain(
      parseChunks(file, request('demand_history', demandHeader)),
    )
    expect(summary.rowsTotal).toBe(60_000)
    expect(events.map((event) => event.chunk.rows.length)).toEqual(Array(6).fill(10_000))
    expect(events.every((event) => event.chunk.bytes <= 1_000_000)).toBe(true)
    const rows = rowsOf(events)
    expect(rows[59_999]).toEqual([
      60_000,
      'P-60000',
      'RUH-01',
      '2024-01-05',
      String(60_000 % 7),
      null,
      null,
    ])
  })

  it('reports extra cells, parse errors and dot decimals under a declared comma', async () => {
    const file = new File(
      [
        'item_code,location_code,demand_date,quantity\nP-1,RUH,2024-01-05,1,5\nP-2,RUH,2024-01-06,"2\n',
      ],
      'demand_history.csv',
    )
    const { summary } = await drain(parseChunks(file, request('demand_history', demandHeader)))
    expect(summary.issues.extra_cells).toEqual({ count: 1, examples: [{ row: 1, value: '5' }] })
    expect(summary.issues.parse_error?.count).toBe(1)
    const comma = new File(
      ['item_code;location_code;demand_date;quantity\nP-1;R;2024-01-05;1.5\n'],
      'd.csv',
    )
    const { summary: commaSummary } = await drain(parseChunks(comma, demandRequest()))
    expect(commaSummary.issues.ambiguous_decimal?.examples).toEqual([
      { row: 1, column: 'quantity', value: '1.5' },
    ])
  })

  it('streams XLSX rows from the inspected workbook', async () => {
    const file = await xlsxFile(
      'items.xlsx',
      [
        [
          'item_code',
          'name_en',
          'product_group',
          'unit_of_measure',
          'unit_cost',
          'currency',
          'introduced_on',
        ],
        [
          { t: 'n', v: 123, z: '00000' },
          'Oil filter',
          'Filters',
          'each',
          12.5,
          'sar',
          { t: 'n', v: 45292 - 1462 },
        ],
        ['P-2', 'Air filter', 'Filters', 'each', 0.1 + 0.2, 'SAR', null],
      ],
      true,
    )
    const cache: WorkbookCacheRef = { current: null }
    const inspected = await inspectFile(file, {}, cache)
    const header = inspected.header
    const { events, summary } = await drain(
      parseChunks(
        file,
        request('items', header, {
          sheet: inspected.sheet,
          normalize: {
            decimalSeparator: '.',
            dateOrder: 'YYYY-MM-DD',
            date1904: inspected.date1904,
          },
        }),
        cache,
      ),
    )
    const entity = getEntity('items')
    const at = (row: unknown[], column: string) =>
      row[1 + entity.columns.findIndex((c) => c.name === column)]
    const [first, second] = rowsOf(events)
    expect(at(first!, 'item_code')).toBe('00123')
    expect(at(first!, 'currency')).toBe('SAR')
    expect(at(first!, 'introduced_on')).toBe('2024-01-01')
    expect(at(first!, 'status')).toBeNull()
    expect(at(second!, 'unit_cost')).toBe('0.3')
    expect(at(second!, 'introduced_on')).toBe('')
    expect(summary.rowsTotal).toBe(2)
    expect(summary.issues.numeric_code_cell?.count).toBe(1)
  })

  it('refuses a plan of the wrong width', async () => {
    const generator = parseChunks(new File(['a\n1\n'], 'items.csv'), {
      ...request('items', ['item_code']),
      sources: [0],
    })
    await expect(generator.next()).rejects.toThrow(/sources/)
  })
})

describe('createWorkerHandler', () => {
  it('answers inspect, then one chunk per parse or pull, then done', async () => {
    const messages: WorkerResponse[] = []
    const handle = createWorkerHandler((message) => messages.push(message))
    const lines = ['item_code,location_code,demand_date,quantity']
    for (let row = 1; row <= 5; row += 1) lines.push(`P-${row},RUH,2024-01-05,1`)
    const file = new File([lines.join('\n')], 'demand_history.csv')

    await handle({ type: 'inspect', id: 1, file, options: {} })
    expect(messages.shift()).toMatchObject({
      type: 'inspected',
      id: 1,
      result: { header: lines[0]!.split(',') },
    })

    const parse = request('demand_history', lines[0]!.split(','), { limits: { maxRows: 2 } })
    await handle({ type: 'parse', id: 2, file, request: parse })
    expect(messages).toHaveLength(1)
    expect(messages.shift()).toMatchObject({
      type: 'chunk',
      id: 2,
      event: { chunk: { firstRow: 1, lastRow: 2 } },
    })
    await handle({ type: 'pull', id: 2 })
    await handle({ type: 'pull', id: 2 })
    await handle({ type: 'pull', id: 2 })
    expect(messages.map((message) => message.type)).toEqual(['chunk', 'chunk', 'done'])
    expect(messages[2]).toMatchObject({ type: 'done', summary: { rowsTotal: 5 } })
  })

  it('reports failures with machine codes and stops on cancel', async () => {
    const messages: WorkerResponse[] = []
    const handle = createWorkerHandler((message) => messages.push(message))
    await handle({ type: 'inspect', id: 1, file: new File([], 'x.csv'), options: {} })
    expect(messages.shift()).toMatchObject({ type: 'failed', id: 1, error: { code: 'empty_file' } })

    const file = new File(
      ['item_code,location_code,demand_date,quantity\nP-1,R,2024-01-05,1\nP-2,R,2024-01-05,1\n'],
      'd.csv',
    )
    await handle({
      type: 'parse',
      id: 2,
      file,
      request: request(
        'demand_history',
        ['item_code', 'location_code', 'demand_date', 'quantity'],
        { limits: { maxRows: 1 } },
      ),
    })
    await handle({ type: 'cancel', id: 2 })
    await handle({ type: 'pull', id: 2 })
    expect(messages.map((message) => message.type)).toEqual(['chunk'])
    await handle({ type: 'release' })
  })
})
