import type { SheetCell } from './normalize'

/**
 * XLSX workbooks through SheetJS 0.20.3 (the official CDN build; npm's 0.18.5 has unfixed CVEs),
 * loaded with a dynamic import so it only ships in the parse worker's chunk and only for
 * workbooks. Sheets are read in dense mode with raw cell types (`cellDates: false`, so dates
 * stay serial numbers and `normalize.ts` applies the workbook's 1900 or 1904 system), at most
 * `maxRows` data rows (SheetJS `sheetRows`, which bounds memory), and only the chosen sheet.
 */

export type SheetJs = typeof import('xlsx')

let sheetJs: Promise<SheetJs> | null = null

/** SheetJS, imported on first use. */
export function loadSheetJs(): Promise<SheetJs> {
  sheetJs ??= import('xlsx').catch((error: unknown) => {
    sheetJs = null
    throw error
  })
  return sheetJs
}

export type SheetInfo = { name: string; hidden: boolean }

export type WorkbookInfo = {
  sheets: SheetInfo[]
  /** The workbook counts dates from 1904-01-01 (`WBProps.date1904`, Mac Excel). */
  date1904: boolean
}

const BASE_OPTIONS = {
  type: 'array',
  dense: true,
  cellDates: false,
  cellFormula: false,
  cellHTML: false,
  cellStyles: false,
  cellNF: false,
  cellText: true,
  bookVBA: false,
} as const

/**
 * True for a ZIP container (`PK\x03\x04`). SheetJS also reads CSV, HTML, XLS and more; a file
 * named .xlsx must really be one, so text never takes the workbook path.
 */
export function isZipContainer(data: ArrayBuffer | Uint8Array): boolean {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

const WORKBOOK_TYPES = new Set(['xlsx', 'xlsm'])

function assertWorkbook(data: ArrayBuffer | Uint8Array, bookType?: string): void {
  if (!isZipContainer(data) || (bookType !== undefined && !WORKBOOK_TYPES.has(bookType))) {
    throw new Error('Not an XLSX workbook')
  }
}

/** Sheet names, visibility and the date system, without parsing any sheet. */
export function readWorkbookInfo(XLSX: SheetJs, data: ArrayBuffer | Uint8Array): WorkbookInfo {
  assertWorkbook(data)
  const workbook = XLSX.read(data, { ...BASE_OPTIONS, sheets: [] })
  assertWorkbook(data, workbook.bookType)
  const flags = workbook.Workbook?.Sheets ?? []
  return {
    sheets: workbook.SheetNames.map((name) => ({
      name,
      hidden: Boolean(flags.find((sheet) => sheet.name === name)?.Hidden),
    })),
    date1904: Boolean(workbook.Workbook?.WBProps?.date1904),
  }
}

/** The sheet the wizard opens with: the first visible one. */
export function defaultSheet(info: WorkbookInfo): string | null {
  return (info.sheets.find((sheet) => !sheet.hidden) ?? info.sheets[0])?.name ?? null
}

export type SheetTable = {
  name: string
  /** Header cells (the first row of the sheet's range). */
  header: SheetCell[]
  /** Data rows read (after the header), at most `maxRows + 1`. */
  rowCount: number
  /** Data rows in the sheet's full range (larger than `rowCount` when the sheet was cut). */
  totalRows: number
  /** The cells of data row `index` (0-based, after the header), one per header column. */
  row(index: number): SheetCell[]
}

type DenseSheet = {
  '!ref'?: string
  '!fullref'?: string
  '!data'?: (({ t?: string; v?: unknown; w?: string } | undefined)[] | undefined)[]
}

function minimalCell(cell: { t?: string; v?: unknown; w?: string } | undefined): SheetCell {
  if (!cell || cell.t === undefined || cell.t === 'z') return { t: 'z' }
  const result: SheetCell = { t: cell.t as SheetCell['t'] }
  if (
    typeof cell.v === 'string' ||
    typeof cell.v === 'number' ||
    typeof cell.v === 'boolean' ||
    cell.v instanceof Date
  ) {
    result.v = cell.v
  }
  if (typeof cell.w === 'string') result.w = cell.w
  return result
}

/**
 * Reads one sheet, at most `maxRows` data rows plus one (so a caller can tell that the sheet
 * holds more; `totalRows` gives the full range).
 */
export function readSheet(
  XLSX: SheetJs,
  data: ArrayBuffer | Uint8Array,
  sheetName: string,
  maxRows: number,
): SheetTable {
  assertWorkbook(data)
  const workbook = XLSX.read(data, { ...BASE_OPTIONS, sheets: sheetName, sheetRows: maxRows + 2 })
  const sheet = workbook.Sheets[sheetName] as DenseSheet | undefined
  if (!sheet) throw new Error(`Sheet not found: ${sheetName}`)
  if (!sheet['!ref']) {
    return { name: sheetName, header: [], rowCount: 0, totalRows: 0, row: () => [] }
  }
  const range = XLSX.utils.decode_range(sheet['!ref'])
  const full = sheet['!fullref'] ? XLSX.utils.decode_range(sheet['!fullref']) : range
  const rows = sheet['!data'] ?? []
  const width = range.e.c - range.s.c + 1
  const cellsOf = (rowIndex: number): SheetCell[] => {
    const source = rows[rowIndex]
    const cells: SheetCell[] = new Array<SheetCell>(width)
    for (let column = 0; column < width; column += 1) {
      cells[column] = minimalCell(source?.[range.s.c + column])
    }
    return cells
  }
  return {
    name: sheetName,
    header: cellsOf(range.s.r),
    rowCount: Math.max(0, range.e.r - range.s.r),
    totalRows: Math.max(0, full.e.r - range.s.r),
    row: (index) => cellsOf(range.s.r + 1 + index),
  }
}
