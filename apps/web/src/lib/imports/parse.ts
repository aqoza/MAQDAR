import {
  ChunkBuilder,
  chunkLimitsFor,
  type Chunk,
  type ChunkIssue,
  type ChunkLimits,
} from './chunks'
import {
  IMPORT_LIMITS,
  getEntity,
  sourceFormatFor,
  type EntityName,
  type SourceFormat,
} from './contract'
import {
  CsvRecordError,
  csvRecords,
  detectDialect,
  type DelimiterChoice,
  type Dialect,
} from './csv'
import {
  createTextDecoder,
  decodeBlob,
  detectEncoding,
  hasReplacementCharacters,
  type DetectedEncoding,
  type EncodingChoice,
} from './encoding'
import {
  displayRawCell,
  isBlankCell,
  normalizeRow,
  normalizeText,
  type NormalizeIssue,
  type NormalizeOptions,
  type RawCell,
  type RowPlan,
} from './normalize'
import {
  defaultSheet,
  loadSheetJs,
  readSheet,
  readWorkbookInfo,
  type SheetInfo,
  type SheetTable,
  type WorkbookInfo,
} from './xlsx'

/**
 * The parse pipeline of the import wizard: inspect a file (format, encoding, delimiter or
 * sheet, header, preview, SHA-256), then stream it as staged chunks (normalized cells, contiguous
 * row numbers, byte and row caps). It runs inside `parse.worker.ts`, or on the main thread when
 * no module worker is available (`parse-client.ts` hides which). The worker's message handler
 * lives here too, so the protocol is tested without a real worker. No DOM, no network.
 */

export type FileLike = Blob & { readonly name: string; readonly lastModified?: number }

/* ------------------------------------------------------------------------------------------ */
/* Problems and issues                                                                          */
/* ------------------------------------------------------------------------------------------ */

/** Why a file cannot be imported as it is. */
export type FileProblemCode =
  | 'unsupported_type'
  | 'empty_file'
  | 'too_large'
  | 'too_many_rows'
  | 'too_many_columns'
  | 'no_header'
  | 'unreadable'
  | 'record_too_long'

export type FileProblem = { code: FileProblemCode; detail?: Record<string, string | number> }

export class ImportFileError extends Error {
  constructor(
    readonly code: FileProblemCode,
    message: string,
    readonly detail?: Record<string, string | number>,
  ) {
    super(message)
    this.name = 'ImportFileError'
  }
}

/** Things the parser noticed that the user should see (they do not stop the import). */
export type ParseIssueCode =
  | NormalizeIssue
  | ChunkIssue
  /** Papa Parse recovered from malformed quoting. */
  | 'parse_error'
  /** A row has non-empty cells beyond the header (often the wrong delimiter). */
  | 'extra_cells'
  /** The decoded text contains U+FFFD (probably the wrong encoding). */
  | 'replacement_characters'

export type IssueExample = { row: number; column?: string; value?: string; message?: string }

export type IssueSummary = Partial<
  Record<ParseIssueCode, { count: number; examples: IssueExample[] }>
>

const MAX_EXAMPLES = 5
const MAX_EXAMPLE_CHARS = 200

class IssueCollector {
  private readonly issues: IssueSummary = {}

  add(code: ParseIssueCode, example: IssueExample): void {
    const entry = (this.issues[code] ??= { count: 0, examples: [] })
    entry.count += 1
    if (entry.examples.length < MAX_EXAMPLES) {
      entry.examples.push(
        example.value === undefined
          ? example
          : { ...example, value: example.value.slice(0, MAX_EXAMPLE_CHARS) },
      )
    }
  }

  summary(): IssueSummary {
    return structuredClone(this.issues)
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Inspect                                                                                     */
/* ------------------------------------------------------------------------------------------ */

export type InspectOptions = {
  encoding?: EncodingChoice
  delimiter?: DelimiterChoice
  /** XLSX sheet; the first visible sheet when absent or unknown. */
  sheet?: string | null
}

export type InspectResult = {
  name: string
  size: number
  format: SourceFormat
  /** Lower-case hex SHA-256 of the file's bytes (duplicate check, batch manifest). */
  sha256: string
  /** CSV: the encoding used (detected or chosen). */
  encoding: DetectedEncoding | null
  /** CSV: delimiter and line ending; `detected` false when the comma was a fallback. */
  dialect: (Dialect & { detected: boolean }) | null
  /** XLSX: every sheet, the one read, and its date system. */
  sheets: SheetInfo[]
  sheet: string | null
  date1904: boolean
  /** Header texts (invisible marks removed, no-break spaces made plain, trimmed). */
  header: string[]
  /** The first data rows as read (strings, or XLSX cells), for the preview table. */
  preview: RawCell[][]
  /** XLSX: data rows without trailing blank rows. CSV: unknown until parsed (null). */
  rowCount: number | null
  /** Problems that block the import (too many rows or columns, no header). */
  problems: FileProblem[]
  issues: IssueSummary
}

/** Workbooks stay parsed between inspecting and staging (one file at a time). */
export type WorkbookCacheRef = {
  current: {
    key: string
    data: Uint8Array
    info: WorkbookInfo
    sheet: string
    table: SheetTable
  } | null
}

export function fileKey(file: FileLike): string {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified ?? 0}`
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function headerTexts(cells: readonly RawCell[]): string[] {
  return cells.map((cell) => normalizeText(displayRawCell(cell)))
}

function checkFile(file: FileLike): SourceFormat {
  const format = sourceFormatFor(file.name)
  if (format === null) {
    throw new ImportFileError('unsupported_type', 'Only CSV, TSV, TXT and XLSX files are accepted')
  }
  if (file.size === 0) throw new ImportFileError('empty_file', 'The file is empty')
  const max = format === 'xlsx' ? IMPORT_LIMITS.xlsxBytes : IMPORT_LIMITS.fileBytes
  if (file.size > max) {
    throw new ImportFileError('too_large', `The file is larger than ${max} bytes`, {
      max,
      size: file.size,
    })
  }
  return format
}

function headerProblems(header: readonly string[]): FileProblem[] {
  const problems: FileProblem[] = []
  if (header.every((text) => text === '')) problems.push({ code: 'no_header' })
  if (header.length > IMPORT_LIMITS.headerColumns) {
    problems.push({
      code: 'too_many_columns',
      detail: { max: IMPORT_LIMITS.headerColumns, count: header.length },
    })
  }
  return problems
}

const SAMPLE_BYTES = 64 * 1024

/** Format, encoding or sheet, header, preview and hash of a file. */
export async function inspectFile(
  file: FileLike,
  options: InspectOptions = {},
  cache: WorkbookCacheRef = { current: null },
): Promise<InspectResult> {
  const format = checkFile(file)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const sha256 = await sha256Hex(bytes)
  const base = { name: file.name, size: file.size, format, sha256 }
  return format === 'csv'
    ? { ...base, ...(await inspectCsv(file, bytes, options)) }
    : { ...base, ...(await inspectXlsx(file, bytes, options, cache)) }
}

type InspectPart = Omit<InspectResult, 'name' | 'size' | 'format' | 'sha256'>

async function inspectCsv(
  file: FileLike,
  bytes: Uint8Array,
  options: InspectOptions,
): Promise<InspectPart> {
  const encoding = detectEncoding(bytes, options.encoding ?? 'auto')
  let sample = createTextDecoder(encoding).decode(bytes.subarray(0, SAMPLE_BYTES), false)
  if (sample.charCodeAt(0) === 0xfeff) sample = sample.slice(1)
  const dialect = detectDialect(sample, options.delimiter ?? 'auto')
  const issues = new IssueCollector()
  if (hasReplacementCharacters(sample)) issues.add('replacement_characters', { row: 0 })

  let header: string[] = []
  const preview: RawCell[][] = []
  let seenHeader = false
  try {
    for await (const record of csvRecords(
      decodeBlob(file, encoding, 256 * 1024),
      dialect,
      (error) => issues.add('parse_error', { row: error.record, message: error.code }),
    )) {
      if (!seenHeader) {
        header = headerTexts(record)
        seenHeader = true
        continue
      }
      preview.push(record)
      if (preview.length >= IMPORT_LIMITS.previewRows) break
    }
  } catch (error) {
    if (!(error instanceof CsvRecordError)) throw error
    issues.add('parse_error', { row: error.detail.record, message: error.detail.code })
  }
  return {
    encoding,
    dialect,
    sheets: [],
    sheet: null,
    date1904: false,
    header,
    preview,
    rowCount: null,
    problems: headerProblems(header),
    issues: issues.summary(),
  }
}

function dataRowsWithoutTrailingBlanks(table: SheetTable): number {
  let count = Math.min(table.rowCount, IMPORT_LIMITS.xlsxRows + 1)
  while (count > 0 && table.row(count - 1).every(isBlankCell)) count -= 1
  return count
}

async function openSheet(
  file: FileLike,
  bytes: Uint8Array,
  requested: string | null | undefined,
  cache: WorkbookCacheRef,
) {
  const key = fileKey(file)
  const cached = cache.current
  if (cached && cached.key === key && (!requested || requested === cached.sheet)) return cached
  const XLSX = await loadSheetJs()
  let info: WorkbookInfo
  try {
    info = cached && cached.key === key ? cached.info : readWorkbookInfo(XLSX, bytes)
  } catch {
    throw new ImportFileError('unreadable', 'The workbook could not be read')
  }
  const sheet =
    requested && info.sheets.some((candidate) => candidate.name === requested)
      ? requested
      : defaultSheet(info)
  if (sheet === null) throw new ImportFileError('unreadable', 'The workbook has no sheets')
  let table: SheetTable
  try {
    table = readSheet(XLSX, bytes, sheet, IMPORT_LIMITS.xlsxRows)
  } catch {
    throw new ImportFileError('unreadable', 'The sheet could not be read')
  }
  cache.current = { key, data: bytes, info, sheet, table }
  return cache.current
}

async function inspectXlsx(
  file: FileLike,
  bytes: Uint8Array,
  options: InspectOptions,
  cache: WorkbookCacheRef,
): Promise<InspectPart> {
  const { info, sheet, table } = await openSheet(file, bytes, options.sheet, cache)
  const header = headerTexts(table.header)
  const rowCount = dataRowsWithoutTrailingBlanks(table)
  const preview: RawCell[][] = []
  for (let index = 0; index < Math.min(rowCount, IMPORT_LIMITS.previewRows); index += 1) {
    preview.push(table.row(index))
  }
  const problems = headerProblems(header)
  if (table.totalRows > IMPORT_LIMITS.xlsxRows) {
    problems.push({
      code: 'too_many_rows',
      detail: { max: IMPORT_LIMITS.xlsxRows, count: table.totalRows },
    })
  }
  return {
    encoding: null,
    dialect: null,
    sheets: info.sheets,
    sheet,
    date1904: info.date1904,
    header,
    preview,
    rowCount: Math.min(rowCount, IMPORT_LIMITS.xlsxRows),
    problems,
    issues: {},
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Preview after mapping                                                                       */
/* ------------------------------------------------------------------------------------------ */

/** Normalizes preview rows the way staging will, with the issues they raise. */
export function normalizePreview(
  entityName: EntityName,
  sources: readonly (number | null)[],
  options: NormalizeOptions,
  rows: readonly (readonly RawCell[])[],
): { rows: (string | null)[][]; issues: IssueSummary } {
  const entity = getEntity(entityName)
  const plan: RowPlan = { columns: entity.columns, sources, options }
  const issues = new IssueCollector()
  const normalized = rows.map((cells, index) =>
    normalizeRow(plan, cells, (issue, column) =>
      issues.add(issue, {
        row: index + 1,
        column: entity.columns[column]?.name,
        value: displayRawCell(cells[sources[column] ?? -1]),
      }),
    ),
  )
  return { rows: normalized, issues: issues.summary() }
}

/* ------------------------------------------------------------------------------------------ */
/* Staging chunks                                                                               */
/* ------------------------------------------------------------------------------------------ */

export type ParseRequest = {
  entity: EntityName
  /** Source column per contract column (`sourceIndexes` from mapping.ts). */
  sources: readonly (number | null)[]
  normalize: NormalizeOptions
  /** CSV: the encoding from `inspectFile` (or a choice to detect again). */
  encoding?: DetectedEncoding | EncodingChoice
  /** CSV: the delimiter from `inspectFile` (or a choice to detect again). */
  delimiter?: DelimiterChoice
  /** XLSX: the sheet from `inspectFile`. */
  sheet?: string | null
  /** Tighter chunk limits (after the server timed out on a chunk). */
  limits?: Partial<ChunkLimits>
  /** First row to send (rows before it were staged earlier); 1 by default. */
  startRow?: number
}

export type ChunkEvent = {
  chunk: Chunk
  /** Data rows read so far. */
  rowsRead: number
  /** Share of the file read, 0..1. */
  progress: number
}

export type ParseSummary = {
  /** Data rows of the file (`p_rows_total` when sealing); trailing blank rows not counted. */
  rowsTotal: number
  trailingBlankRows: number
  issues: IssueSummary
}

export type ParseHooks = {
  /** Awaited every few thousand rows (the main-thread fallback yields to the UI here). */
  pause?: () => Promise<void>
}

const PAUSE_EVERY_ROWS = 2_000

type RowSource = {
  rows: AsyncIterable<RawCell[]> | Iterable<RawCell[]>
  progress: () => number
  headerWidth: number
}

async function csvSource(
  file: FileLike,
  request: ParseRequest,
  issues: IssueCollector,
): Promise<RowSource> {
  // Normally the encoding and delimiter inspected earlier; detected again when not given.
  const encoding =
    typeof request.encoding === 'object'
      ? request.encoding
      : detectEncoding(new Uint8Array(await file.arrayBuffer()), request.encoding ?? 'auto')
  let sample = createTextDecoder(encoding).decode(
    new Uint8Array(await file.slice(0, SAMPLE_BYTES).arrayBuffer()),
    false,
  )
  if (sample.charCodeAt(0) === 0xfeff) sample = sample.slice(1)
  const { delimiter, newline } = detectDialect(sample, request.delimiter ?? 'auto')
  const dialect: Dialect = { delimiter, newline }

  let bytesRead = 0
  const records = csvRecords(
    decodeBlob(file, encoding, 1 << 20, (read) => {
      bytesRead = read
    }),
    dialect,
    (error) => issues.add('parse_error', { row: error.record, message: error.code }),
  )
  // The first record is the header.
  const first = await records.next()
  const headerWidth = first.done ? 0 : first.value.length
  return {
    rows: records,
    progress: () => (file.size === 0 ? 1 : bytesRead / file.size),
    headerWidth,
  }
}

async function xlsxSource(
  file: FileLike,
  request: ParseRequest,
  cache: WorkbookCacheRef,
): Promise<RowSource> {
  const key = fileKey(file)
  const bytes =
    cache.current && cache.current.key === key
      ? cache.current.data
      : new Uint8Array(await file.arrayBuffer())
  const { table } = await openSheet(file, bytes, request.sheet, cache)
  if (table.totalRows > IMPORT_LIMITS.xlsxRows) {
    throw new ImportFileError(
      'too_many_rows',
      `The sheet has more than ${IMPORT_LIMITS.xlsxRows} rows`,
      {
        max: IMPORT_LIMITS.xlsxRows,
        count: table.totalRows,
      },
    )
  }
  const total = Math.min(table.rowCount, IMPORT_LIMITS.xlsxRows)
  let index = 0
  function* rows(): Generator<RawCell[], void, undefined> {
    for (; index < total; index += 1) yield table.row(index)
  }
  return {
    rows: rows(),
    progress: () => (total === 0 ? 1 : index / total),
    headerWidth: table.header.length,
  }
}

/**
 * Streams a file as staged chunks. Each yielded event carries one chunk; the return value is the
 * summary (rows, issues). Middle blank rows are sent (the database reports their empty keys, so
 * row numbers keep matching the file); trailing blank rows are dropped. Cancel with `return()`.
 */
export async function* parseChunks(
  file: FileLike,
  request: ParseRequest,
  cache: WorkbookCacheRef = { current: null },
  hooks: ParseHooks = {},
): AsyncGenerator<ChunkEvent, ParseSummary, undefined> {
  const format = checkFile(file)
  const entity = getEntity(request.entity)
  if (request.sources.length !== entity.columns.length) {
    throw new Error(`Expected ${entity.columns.length} sources, got ${request.sources.length}`)
  }
  const issues = new IssueCollector()
  const plan: RowPlan = {
    columns: entity.columns,
    sources: request.sources,
    options: request.normalize,
  }
  const startRow = Math.max(1, Math.floor(request.startRow ?? 1))
  const builder = new ChunkBuilder(
    entity.columns.length,
    chunkLimitsFor(request.entity, request.limits),
    {
      startRow,
      report: (issue, row, column) =>
        issues.add(issue, { row, column: entity.columns[column]?.name }),
    },
  )
  const source =
    format === 'csv'
      ? await csvSource(file, request, issues)
      : await xlsxSource(file, request, cache)

  let rowNo = 0
  let blanks = 0
  const event = (chunk: Chunk): ChunkEvent => ({
    chunk,
    rowsRead: rowNo,
    progress: source.progress(),
  })
  const add = (cells: readonly RawCell[]): Chunk | null => {
    rowNo += 1
    if (rowNo > IMPORT_LIMITS.rowsPerBatch) {
      throw new ImportFileError(
        'too_many_rows',
        `The file has more than ${IMPORT_LIMITS.rowsPerBatch} rows`,
        {
          max: IMPORT_LIMITS.rowsPerBatch,
        },
      )
    }
    if (rowNo < startRow) return null
    const values = normalizeRow(plan, cells, (issue, column) =>
      issues.add(issue, {
        row: rowNo,
        column: entity.columns[column]?.name,
        value: displayRawCell(cells[request.sources[column] ?? -1]),
      }),
    )
    return builder.add(rowNo, values)
  }

  try {
    for await (const cells of source.rows) {
      if (cells.every(isBlankCell)) {
        blanks += 1
        continue
      }
      for (; blanks > 0; blanks -= 1) {
        const chunk = add([])
        if (chunk) yield event(chunk)
      }
      if (
        cells.length > source.headerWidth &&
        cells.slice(source.headerWidth).some((cell) => !isBlankCell(cell))
      ) {
        issues.add('extra_cells', {
          row: rowNo + 1,
          value: cells.slice(source.headerWidth).map(displayRawCell).join(' | '),
        })
      }
      const chunk = add(cells)
      if (chunk) yield event(chunk)
      if (hooks.pause && rowNo % PAUSE_EVERY_ROWS === 0) await hooks.pause()
    }
  } catch (error) {
    if (error instanceof CsvRecordError) {
      throw new ImportFileError('record_too_long', error.message, { row: error.detail.record })
    }
    throw error
  }
  const last = builder.flush()
  if (last) yield event(last)
  return { rowsTotal: rowNo, trailingBlankRows: blanks, issues: issues.summary() }
}

/* ------------------------------------------------------------------------------------------ */
/* Worker protocol                                                                              */
/* ------------------------------------------------------------------------------------------ */

export type ParseErrorPayload = {
  code: FileProblemCode | 'internal'
  message: string
  detail?: Record<string, string | number>
}

export type WorkerRequest =
  | { type: 'inspect'; id: number; file: FileLike; options: InspectOptions }
  /** Starts streaming; the worker answers with the first chunk. */
  | { type: 'parse'; id: number; file: FileLike; request: ParseRequest }
  /** Asks for the next chunk of a parse. */
  | { type: 'pull'; id: number }
  | { type: 'cancel'; id: number }
  /** Drops the cached workbook. */
  | { type: 'release' }

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'inspected'; id: number; result: InspectResult }
  | { type: 'chunk'; id: number; event: ChunkEvent }
  | { type: 'done'; id: number; summary: ParseSummary }
  | { type: 'failed'; id: number; error: ParseErrorPayload }

export function toErrorPayload(error: unknown): ParseErrorPayload {
  if (error instanceof ImportFileError) {
    return error.detail
      ? { code: error.code, message: error.message, detail: error.detail }
      : { code: error.code, message: error.message }
  }
  return { code: 'internal', message: error instanceof Error ? error.message : String(error) }
}

/**
 * The worker side of the protocol: one parse runs per id, and each `parse`/`pull` produces exactly
 * one `chunk`, `done` or `failed` message, so the page decides how far the worker reads ahead.
 */
export function createWorkerHandler(
  post: (message: WorkerResponse) => void,
  hooks: ParseHooks = {},
) {
  const cache: WorkbookCacheRef = { current: null }
  const sessions = new Map<
    number,
    { generator: AsyncGenerator<ChunkEvent, ParseSummary, undefined>; queue: Promise<void> }
  >()

  const step = (id: number) => {
    const session = sessions.get(id)
    if (!session) return Promise.resolve()
    session.queue = session.queue.then(async () => {
      if (!sessions.has(id)) return
      try {
        const next = await session.generator.next()
        if (next.done) {
          sessions.delete(id)
          post({ type: 'done', id, summary: next.value })
        } else {
          post({ type: 'chunk', id, event: next.value })
        }
      } catch (error) {
        sessions.delete(id)
        post({ type: 'failed', id, error: toErrorPayload(error) })
      }
    })
    return session.queue
  }

  return async function handle(message: WorkerRequest): Promise<void> {
    switch (message.type) {
      case 'inspect':
        try {
          post({
            type: 'inspected',
            id: message.id,
            result: await inspectFile(message.file, message.options, cache),
          })
        } catch (error) {
          post({ type: 'failed', id: message.id, error: toErrorPayload(error) })
        }
        return
      case 'parse':
        sessions.set(message.id, {
          generator: parseChunks(message.file, message.request, cache, hooks),
          queue: Promise.resolve(),
        })
        return step(message.id)
      case 'pull':
        return step(message.id)
      case 'cancel': {
        const session = sessions.get(message.id)
        sessions.delete(message.id)
        if (session) {
          await session.queue
          await session.generator.return({ rowsTotal: 0, trailingBlankRows: 0, issues: {} })
        }
        return
      }
      case 'release':
        cache.current = null
        return
    }
  }
}
