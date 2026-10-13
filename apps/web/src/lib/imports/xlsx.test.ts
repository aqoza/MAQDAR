import { describe, expect, it } from 'vitest'
import { getEntity } from './contract'
import { normalizeRow, type RowPlan } from './normalize'
import {
  defaultSheet,
  isZipContainer,
  loadSheetJs,
  readSheet,
  readWorkbookInfo,
  type SheetJs,
} from './xlsx'

type CellSpec = string | number | boolean | { t: 'n' | 's' | 'b'; v: unknown; z?: string } | null

async function workbook(
  sheets: { name: string; rows: CellSpec[][]; hidden?: boolean }[],
  date1904 = false,
): Promise<{ XLSX: SheetJs; data: Uint8Array }> {
  const XLSX = await loadSheetJs()
  const book = XLSX.utils.book_new()
  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.rows as unknown[][])
    // aoa_to_sheet takes cell objects as they are, formats (z) included.
    XLSX.utils.book_append_sheet(book, ws, sheet.name)
  }
  book.Workbook = {
    Sheets: sheets.map((sheet) => ({ name: sheet.name, Hidden: sheet.hidden ? 1 : 0 })),
    WBProps: { date1904 },
  }
  const data = new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
  return { XLSX, data }
}

describe('loadSheetJs', () => {
  it('loads SheetJS 0.20.3 once', async () => {
    const first = await loadSheetJs()
    expect(first.version).toBe('0.20.3')
    expect(await loadSheetJs()).toBe(first)
  })
})

describe('readWorkbookInfo', () => {
  it('lists sheets with visibility and the date system without parsing them', async () => {
    const { XLSX, data } = await workbook(
      [
        { name: 'Notes', rows: [['read me']], hidden: true },
        { name: 'Items', rows: [['item_code'], ['P-1']] },
      ],
      true,
    )
    const info = readWorkbookInfo(XLSX, data)
    expect(info).toEqual({
      sheets: [
        { name: 'Notes', hidden: true },
        { name: 'Items', hidden: false },
      ],
      date1904: true,
    })
    expect(defaultSheet(info)).toBe('Items')
    expect(defaultSheet({ sheets: [{ name: 'Only', hidden: true }], date1904: false })).toBe('Only')
    expect(defaultSheet({ sheets: [], date1904: false })).toBeNull()
  })
})

describe('readSheet', () => {
  it('reads raw cell types, formatted text and the header', async () => {
    const { XLSX, data } = await workbook([
      {
        name: 'Items',
        rows: [
          ['item_code', 'name_ar', 'unit_cost', 'introduced_on', 'is_preferred'],
          [
            { t: 'n', v: 123, z: '00000' },
            'فلتر زيت',
            0.1 + 0.2,
            { t: 'n', v: 45292, z: 'yyyy-mm-dd' },
            true,
          ],
          ['P-2', null, 12.5, '05/01/2024', false],
        ],
      },
    ])
    const sheet = readSheet(XLSX, data, 'Items', 100)
    expect(sheet.header.map((cell) => cell.v)).toEqual([
      'item_code',
      'name_ar',
      'unit_cost',
      'introduced_on',
      'is_preferred',
    ])
    expect(sheet.rowCount).toBe(2)
    expect(sheet.totalRows).toBe(2)
    const [code, name, cost, date, preferred] = sheet.row(0)
    expect(code).toEqual({ t: 'n', v: 123, w: '00123' })
    expect(name).toMatchObject({ t: 's', v: 'فلتر زيت' })
    expect(cost).toMatchObject({ t: 'n', v: 0.1 + 0.2 })
    expect(date).toMatchObject({ t: 'n', v: 45292 })
    expect(preferred).toMatchObject({ t: 'b', v: true })
    expect(sheet.row(1)[1]).toEqual({ t: 'z' })
    expect(sheet.row(5)).toEqual([{ t: 'z' }, { t: 'z' }, { t: 'z' }, { t: 'z' }, { t: 'z' }])
  })

  it('normalizes 1900 and 1904 workbooks to the same dates', async () => {
    const entity = getEntity('items')
    const sources = entity.columns.map((column) =>
      column.name === 'item_code' ? 0 : column.name === 'introduced_on' ? 1 : null,
    )
    for (const date1904 of [false, true]) {
      const serial = date1904 ? 45292 - 1462 : 45292
      const { XLSX, data } = await workbook(
        [
          {
            name: 'S',
            rows: [
              ['item_code', 'introduced_on'],
              ['P-1', { t: 'n', v: serial, z: 'd/m/yyyy' }],
            ],
          },
        ],
        date1904,
      )
      const info = readWorkbookInfo(XLSX, data)
      expect(info.date1904).toBe(date1904)
      const plan: RowPlan = {
        columns: entity.columns,
        sources,
        options: { decimalSeparator: '.', dateOrder: 'YYYY-MM-DD', date1904: info.date1904 },
      }
      const row = normalizeRow(plan, readSheet(XLSX, data, 'S', 10).row(0))
      expect(row[0]).toBe('P-1')
      expect(row[entity.columns.findIndex((column) => column.name === 'introduced_on')]).toBe(
        '2024-01-01',
      )
    }
  })

  it('reads at most maxRows + 1 data rows and reports the full size', async () => {
    const rows: CellSpec[][] = [['n'], ...Array.from({ length: 30 }, (_, index) => [index + 1])]
    const { XLSX, data } = await workbook([{ name: 'Big', rows }])
    const sheet = readSheet(XLSX, data, 'Big', 10)
    expect(sheet.rowCount).toBe(11)
    expect(sheet.totalRows).toBe(30)
    expect(sheet.row(10)[0]).toMatchObject({ v: 11 })
    expect(sheet.row(11)[0]).toEqual({ t: 'z' })
  })

  it('reads only ZIP workbooks, never text named .xlsx', async () => {
    const XLSX = await loadSheetJs()
    const text = new TextEncoder().encode('item_code\nP-1\n')
    expect(isZipContainer(text)).toBe(false)
    expect(() => readWorkbookInfo(XLSX, text)).toThrow(/Not an XLSX/)
    expect(() => readSheet(XLSX, text, 'Sheet1', 10)).toThrow(/Not an XLSX/)
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['a']]), 'S')
    const ods = new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'ods' }) as ArrayBuffer)
    expect(isZipContainer(ods)).toBe(true)
    expect(() => readWorkbookInfo(XLSX, ods)).toThrow(/Not an XLSX/)
  })

  it('handles an empty sheet and refuses an unknown one', async () => {
    const XLSX = await loadSheetJs()
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), 'Empty')
    const data = new Uint8Array(
      XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer,
    )
    const sheet = readSheet(XLSX, data, 'Empty', 10)
    expect(sheet.header).toEqual([])
    expect(sheet.rowCount).toBe(0)
    expect(() => readSheet(XLSX, data, 'Nope', 10)).toThrow(/Sheet not found/)
  })
})
