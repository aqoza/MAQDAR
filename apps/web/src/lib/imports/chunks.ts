import { IMPORT_LIMITS, getEntity, type EntityName } from './contract'

/**
 * Chunk bodies for `PUT /api/imports/{id}/files/{n}/chunks/{firstRow}`: a compact JSON array of
 * rows `[row_no, c1, …, cn]` with one cell per contract column, `null` for columns the file does
 * not provide and `""` for empty cells. Row numbers count data rows from 1 (the header is not a
 * row) and are contiguous within and across chunks. A chunk holds at most the entity's
 * `stage_rows` (5,000 master rows, 10,000 demand rows) and at most 1 MB of UTF-8. Pure module.
 */

export type ChunkCells = readonly (string | null)[]

export type Chunk = {
  firstRow: number
  lastRow: number
  /** Compact JSON of each row, in order. */
  rows: readonly string[]
  /** UTF-8 bytes of the body (`[` + rows joined by `,` + `]`). */
  bytes: number
}

export type ChunkLimits = {
  /** Rows per chunk. */
  maxRows: number
  /** UTF-8 bytes per chunk body. */
  maxBytes: number
}

/** Issues the builder fixes so the database accepts the chunk; worth showing to the user. */
export type ChunkIssue =
  /** A cell longer than the staging limit (4,000 characters) was cut. */
  | 'cell_truncated'
  /** NUL characters or broken UTF-16 (lone surrogates) were removed or replaced. */
  | 'invalid_characters'

/** The limits for an entity: its `stage_rows` and 1 MB, optionally tightened (never loosened). */
export function chunkLimitsFor(
  entity: EntityName,
  overrides: Partial<ChunkLimits> = {},
): ChunkLimits {
  const stageRows = getEntity(entity).stage_rows
  return {
    maxRows: Math.max(1, Math.min(stageRows, overrides.maxRows ?? stageRows)),
    maxBytes: Math.min(IMPORT_LIMITS.chunkBytes, overrides.maxBytes ?? IMPORT_LIMITS.chunkBytes),
  }
}

const NON_ASCII = /[^\u0000-\u007f]/

/** UTF-8 length of a well-formed string, without encoding it. */
export function utf8Length(text: string): number {
  if (!NON_ASCII.test(text)) return text.length
  let bytes = 0
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      bytes += 4
      index += 1
    } else bytes += 3
  }
  return bytes
}

/** The request body of a chunk. */
export function chunkBody(chunk: Pick<Chunk, 'rows'>): string {
  return `[${chunk.rows.join(',')}]`
}

function bodyBytes(rowBytes: number, rowCount: number): number {
  return 2 + rowBytes + Math.max(0, rowCount - 1)
}

function makeChunk(firstRow: number, rows: readonly string[]): Chunk {
  let rowBytes = 0
  for (const row of rows) rowBytes += utf8Length(row)
  return {
    firstRow,
    lastRow: firstRow + rows.length - 1,
    rows,
    bytes: bodyBytes(rowBytes, rows.length),
  }
}

function codePointLength(text: string): number {
  let count = 0
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) index += 1
    count += 1
  }
  return count
}

/** Makes a cell safe for jsonb text: no NUL, no lone surrogates, at most `maxChars` characters. */
export function sanitizeCell(
  value: string,
  maxChars: number = IMPORT_LIMITS.cellChars,
): { value: string; issue?: ChunkIssue } {
  let text = value
  let issue: ChunkIssue | undefined
  if (text.includes('\u0000') || !text.isWellFormed()) {
    text = text.replaceAll('\u0000', '').toWellFormed()
    issue = 'invalid_characters'
  }
  if (text.length > maxChars && codePointLength(text) > maxChars) {
    text = Array.from(text).slice(0, maxChars).join('')
    issue = 'cell_truncated'
  }
  return issue === undefined ? { value: text } : { value: text, issue }
}

/**
 * Collects rows into chunks. `add` returns the previous chunk when the new row would not fit
 * (by rows or bytes); `flush` returns the last one. Row numbers must arrive contiguously.
 */
export class ChunkBuilder {
  private rows: string[] = []
  private rowBytes = 0
  private firstRow: number
  private nextRow: number
  private readonly report?: (issue: ChunkIssue, rowNo: number, columnIndex: number) => void

  constructor(
    private readonly columnCount: number,
    private readonly limits: ChunkLimits,
    options: {
      /** Row number of the first row added (later than 1 when staging resumes). */
      startRow?: number
      report?: (issue: ChunkIssue, rowNo: number, columnIndex: number) => void
    } = {},
  ) {
    this.firstRow = options.startRow ?? 1
    this.nextRow = this.firstRow
    this.report = options.report
  }

  /** Row number the next `add` must use. */
  get expectedRow(): number {
    return this.nextRow
  }

  add(rowNo: number, cells: ChunkCells): Chunk | null {
    if (rowNo !== this.nextRow) {
      throw new Error(`Rows must be contiguous: expected row ${this.nextRow}, got ${rowNo}`)
    }
    if (cells.length !== this.columnCount) {
      throw new Error(`Row ${rowNo} has ${cells.length} cells, expected ${this.columnCount}`)
    }
    const safe = cells.map((cell, index) => {
      if (cell === null) return null
      const result = sanitizeCell(cell)
      if (result.issue) this.report?.(result.issue, rowNo, index)
      return result.value
    })
    const json = JSON.stringify([rowNo, ...safe])
    const bytes = utf8Length(json)
    if (bodyBytes(bytes, 1) > this.limits.maxBytes) {
      throw new Error(`Row ${rowNo} alone exceeds ${this.limits.maxBytes} bytes`)
    }
    let done: Chunk | null = null
    if (
      this.rows.length >= this.limits.maxRows ||
      (this.rows.length > 0 &&
        bodyBytes(this.rowBytes + bytes, this.rows.length + 1) > this.limits.maxBytes)
    ) {
      done = this.take()
    }
    this.rows.push(json)
    this.rowBytes += bytes
    this.nextRow += 1
    return done
  }

  /** The rows collected since the last chunk, or null when there are none. */
  flush(): Chunk | null {
    return this.rows.length > 0 ? this.take() : null
  }

  private take(): Chunk {
    const chunk: Chunk = {
      firstRow: this.firstRow,
      lastRow: this.firstRow + this.rows.length - 1,
      rows: this.rows,
      bytes: bodyBytes(this.rowBytes, this.rows.length),
    }
    this.firstRow += this.rows.length
    this.rows = []
    this.rowBytes = 0
    return chunk
  }
}

/** Splits a chunk into contiguous pieces of at most `maxRows` rows. */
export function splitChunk(chunk: Chunk, maxRows: number): Chunk[] {
  const size = Math.max(1, Math.floor(maxRows))
  if (chunk.rows.length <= size) return [chunk]
  const pieces: Chunk[] = []
  for (let start = 0; start < chunk.rows.length; start += size) {
    pieces.push(makeChunk(chunk.firstRow + start, chunk.rows.slice(start, start + size)))
  }
  return pieces
}

/** Halves a chunk (after a statement timeout); null when it holds a single row. */
export function halveChunk(chunk: Chunk): [Chunk, Chunk] | null {
  if (chunk.rows.length < 2) return null
  const [first, second] = splitChunk(chunk, Math.ceil(chunk.rows.length / 2))
  return first && second ? [first, second] : null
}

/**
 * The first row not covered by staged ranges counted from row 1 (where staging resumes). Ranges
 * may arrive in any order; a gap stops the count.
 */
export function firstMissingRow(ranges: readonly { firstRow: number; lastRow: number }[]): number {
  const sorted = [...ranges].sort((a, b) => a.firstRow - b.firstRow)
  let next = 1
  for (const range of sorted) {
    if (range.firstRow > next) break
    next = Math.max(next, range.lastRow + 1)
  }
  return next
}
