import { halveChunk, splitChunk, utf8Length, chunkBody, type Chunk } from './chunks'
import { IMPORT_LIMITS, compareLoadOrder, isEntityName, type EntityName } from './contract'

/**
 * Typed wrappers around the wizard's route handlers under `/api/imports` (thin pass-throughs to
 * the `import_*` RPCs), with the retry rules of the approved plan:
 *
 * - chunks are sent one at a time per file, files in load order; a chunk that times out (503) is
 *   halved and both halves are sent, and later chunks of the file go in pieces of that size;
 * - a busy organization (409 `busy` or `import_in_progress`) is retried after a jittered back-off
 *   of 1 to 10 s; network failures are retried a few times (every call is idempotent: chunk
 *   replays, seals and creates with the same batch id return the stored result);
 * - the original file goes straight to Storage with a plain `fetch` PUT to its signed upload URL;
 *   a failure only means the audit copy is missing (the seal reports `source_missing`);
 * - commits repeat while the route answers 202, halving `max_rows` after a timeout.
 *
 * Browser-only at call time (it uses `fetch`); every dependency can be injected for tests.
 */

export const IMPORT_STATUSES = [
  'staging',
  'validated',
  'invalid',
  'committing',
  'succeeded',
  'failed',
  'canceled',
  'expired',
] as const

export type ImportStatus = (typeof IMPORT_STATUSES)[number]

export function isImportStatus(value: unknown): value is ImportStatus {
  return typeof value === 'string' && (IMPORT_STATUSES as readonly string[]).includes(value)
}

/** Statuses after which nothing changes any more (the import may then be deleted). */
export const TERMINAL_STATUSES: readonly ImportStatus[] = ['succeeded', 'canceled', 'expired']

export type CommitMode = 'atomic' | 'stepped'

/** Per entity: what a commit did (parents_set for locations, preferred_cleared for supplier items). */
export type EntityCounts = {
  inserted?: number
  updated?: number
  unchanged?: number
  deleted?: number
  skipped?: number
  parents_set?: number
  preferred_cleared?: number
}

export type CommitPhase = 'prepare' | 'merge' | 'stats' | 'cleanup' | 'done' | 'failed'

/** The stepped-commit cursor (`import_batches.progress` without timings). */
export type CommitProgress = {
  phase?: CommitPhase
  file_no?: number
  pass?: number
  through_row?: number
  stats_for?: string
  steps?: number
}

/** `app.import_batch_state`: the batch as every RPC returns it. */
export type BatchState = {
  batch_id: string
  status: ImportStatus
  commit_mode: CommitMode | null
  rows_total: number
  rows_staged: number
  error_count: number
  warning_count: number
  counts?: Record<string, EntityCounts>
  progress?: CommitProgress
  failure_code: string | null
  failure_detail: string | null
  validated_at: string | null
  commit_started_at: string | null
  last_step_at: string | null
  finished_at: string | null
  expires_at: string | null
}

/** `{code: {column: n}}`, column '' for row-level codes; complete even when details are capped. */
export type ErrorCounts = Record<string, Record<string, number>>

/** `app.import_file_state`. */
export type FileState = {
  file_no: number
  entity: EntityName
  status: 'staging' | 'sealed' | 'merged'
  source_stored: boolean
  rows_total: number
  rows_staged: number
  rows_new: number
  rows_existing: number
  error_count: number
  warning_count: number
  errors_stored: number
  error_counts: ErrorCounts
  merged_through_row: number
  counts: EntityCounts
}

export type FileExtension = 'csv' | 'tsv' | 'txt' | 'xlsx'

/** One file of `import_create_batch(p_files)`. */
export type FileManifest = {
  file_no: number
  entity: EntityName
  original_name: string
  extension: FileExtension
  content_type: string | null
  size_bytes: number
  /** Lower-case hex. */
  sha256: string
  rows_total: number
  /** Provided contract columns (any order; stored in contract order). */
  columns: string[]
  header?: string[]
  /** Contract column → header text, offered again next time. */
  mapping?: Record<string, string>
  parse?: Record<string, string | boolean | null>
}

export type CreatedFile = {
  file_no: number
  entity: EntityName
  storage_path: string
  /** Signed Storage upload URL for the original (null when it could not be signed). */
  upload_url?: string | null
  upload_token?: string | null
  /** Why there is no URL: `exists` when the original is already stored (a retried create). */
  upload_error?: 'exists' | 'failed'
}

export type CreateResult = BatchState & { files: CreatedFile[] }

export type StageResult = {
  file_no: number
  first_row: number
  last_row: number
  rows: number
  staged: number
  duplicates: number
  errors_added: number
  warnings_added: number
  replayed: boolean
  file: FileState
  batch: BatchState
}

export type SealResult = FileState & { batch: BatchState }

export type CommitResult = BatchState & {
  done: boolean
  units: number
  unit?: string | null
  ms?: number | null
}

export type CancelResult = BatchState & { done: boolean }

/** `GET /api/imports/{id}`: the batch row and its files (the file fields of FileState and more). */
export type ImportStatusResult = {
  batch: BatchState & Record<string, unknown>
  files: (FileState & Record<string, unknown>)[]
}

/** What a commit call knows about the batch before its first answer (decides how to retry). */
export type CommitHint = Partial<Pick<BatchState, 'rows_staged' | 'commit_mode' | 'status'>>

/* ------------------------------------------------------------------------------------------ */
/* Errors                                                                                       */
/* ------------------------------------------------------------------------------------------ */

/**
 * A failed call. `status` is the HTTP status (0 when the request never got an answer), `code` the
 * machine code of the body (`MQ409`, `busy`, `timeout`, …) and `hint` the RPC hint naming the
 * offending field or condition (`import_in_progress`, `open_batches`, `rows`, …).
 */
export class ImportApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly hint: string | null,
    message: string,
    /** From `Retry-After`, in milliseconds. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message)
    this.name = 'ImportApiError'
  }
}

export function isImportApiError(error: unknown): error is ImportApiError {
  return error instanceof ImportApiError
}

/** A statement timeout (57014 → 503): send less per call. */
export function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof ImportApiError &&
    (error.status === 503 || error.code === 'timeout' || error.code === '57014')
  )
}

/** Another writer holds the organization's import lock (or a lock or deadlock): try again soon. */
export function isBusyError(error: unknown): boolean {
  return (
    error instanceof ImportApiError &&
    error.status === 409 &&
    (error.code === 'busy' ||
      error.code === 'import_in_progress' ||
      error.hint === 'import_in_progress')
  )
}

function isNetworkError(error: unknown): boolean {
  return error instanceof ImportApiError && error.status === 0
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** Hints the wizard explains in words of its own (`ImportsClient.apiErrors.<hint>`). */
export const EXPLAINED_HINTS = [
  'open_batches',
  'batches_per_day',
  'another_commit',
  'import_in_progress',
  'errors',
  'validation_expired',
  'status',
  'parent',
  'chunks',
  'first_row',
  'rows',
  'rows_total',
  'mapping',
  'cleanup',
  'staging_lost',
] as const

export type ApiErrorKey =
  | (typeof EXPLAINED_HINTS)[number]
  | 'network'
  | 'timeout'
  | 'busy'
  | 'session'
  | 'forbidden'
  | 'not_found'
  | 'too_large'
  | 'stale_organization'
  | 'generic'

/** The message key (`ImportsClient.apiErrors.<key>`) for a failed call. */
export function apiErrorKey(error: unknown): ApiErrorKey {
  if (!(error instanceof ImportApiError)) return 'generic'
  if (error.status === 0) return 'network'
  if (isTimeoutError(error)) return 'timeout'
  if (error.code === 'busy') return 'busy'
  const hint = error.hint ?? ''
  if ((EXPLAINED_HINTS as readonly string[]).includes(hint)) {
    return hint as (typeof EXPLAINED_HINTS)[number]
  }
  if (error.status === 401 || error.code === 'MQ401') return 'session'
  if (error.status === 403 || error.code === 'MQ403') return 'forbidden'
  if (error.status === 404 || error.code === 'MQ404') {
    return hint === 'organization_id' ? 'stale_organization' : 'not_found'
  }
  if (error.status === 413) return 'too_large'
  return 'generic'
}

/* ------------------------------------------------------------------------------------------ */
/* Helpers                                                                                      */
/* ------------------------------------------------------------------------------------------ */

const CONTENT_TYPES: Record<FileExtension, string> = {
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  txt: 'text/plain',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export function extensionOf(fileName: string): FileExtension | null {
  const extension = /\.([A-Za-z0-9]+)$/.exec(fileName.trim())?.[1]?.toLowerCase()
  return extension === 'csv' || extension === 'tsv' || extension === 'txt' || extension === 'xlsx'
    ? extension
    : null
}

/** The content type the Storage bucket accepts for an extension. */
export function contentTypeFor(extension: FileExtension): string {
  return CONTENT_TYPES[extension]
}

/**
 * Caps of one chunk request. The chunk text (`rows`) holds at most 1,000,000 UTF-8 bytes (the
 * builder's cap, under the RPC's 1 MiB), and its `{"rows": "…"}` envelope escapes every quote and
 * backslash again, so it stays under 2,000,016 bytes (the chunk route accepts 2 MiB + 1 KiB). A
 * chunk over either cap (built with looser limits) is split before sending.
 */
export const MAX_CHUNK_TEXT_BYTES = IMPORT_LIMITS.chunkBytes
export const MAX_REQUEST_BYTES = 2_048_000

const MAX_BUSY_RETRIES = 12
const MAX_NETWORK_RETRIES = 3
/** The largest merge unit (demand); stepped commits start without a cap and halve from here. */
const LARGEST_MERGE_ROWS = 10_000
const MIN_COMMIT_ROWS = 100
/** Staged rows up to which import_commit_step commits all at once (one call, max_rows ignored). */
export const ATOMIC_COMMIT_ROWS = 5_000
/** Retries of an all-at-once commit that timed out (each re-runs the whole commit). */
const MAX_ATOMIC_TIMEOUT_RETRIES = 1

/**
 * Whether a commit is (or will be) stepped: the server says so, or it has not chosen yet and the
 * batch holds more than 5,000 staged rows. Unknown batches count as stepped (halving is harmless
 * there; for an atomic commit it only repeats the same doomed call).
 */
export function isSteppedCommit(state: CommitHint | null | undefined): boolean {
  if (!state) return true
  if (state.commit_mode) return state.commit_mode === 'stepped'
  if (state.status === 'committing' || state.status === 'failed') return true
  return state.rows_staged === undefined || state.rows_staged > ATOMIC_COMMIT_ROWS
}

/** Full-jitter back-off between 1 s and min(10 s, 2^attempt s). */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(10_000, 1_000 * 2 ** Math.max(0, attempt))
  return Math.round(1_000 + random() * (ceiling - 1_000))
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 60) * 1_000
  const date = Date.parse(value)
  return Number.isNaN(date) ? null : Math.min(Math.max(0, date - Date.now()), 60_000)
}

// `merge:<entity>:<file_no>:<from>-<to>` plus `:parents` for the second pass over locations.
const MERGE_UNIT = /^merge:[a-z_]+:(\d+):\d+-(\d+)(:parents)?$/

/**
 * Share of a commit done (0..1). Files merge in load order, then by file number, so every file
 * before the one in the last unit (`merge:<entity>:<file_no>:<from>-<to>`) is done; a `stats:`
 * unit means every file up to that entity is done. Falls back to the stored cursor.
 */
export function commitFraction(
  files: readonly { file_no: number; entity: EntityName; rows_total: number }[],
  state: Pick<BatchState, 'status' | 'progress'> & { unit?: string | null },
): number {
  if (state.status === 'succeeded') return 1
  const phase = state.progress?.phase
  if (phase === 'cleanup' || phase === 'done') return 1
  const total = files.reduce((sum, file) => sum + file.rows_total, 0)
  if (total === 0) return 0
  const ordered = [...files].sort(
    (a, b) => compareLoadOrder(a.entity, b.entity) || a.file_no - b.file_no,
  )
  const unit = state.unit ?? ''
  const stats = unit.startsWith('stats:') ? unit.slice('stats:'.length) : null
  if (stats !== null && isEntityName(stats)) {
    const done = ordered
      .filter((file) => compareLoadOrder(file.entity, stats) <= 0)
      .reduce((sum, file) => sum + file.rows_total, 0)
    return Math.min(1, done / total)
  }
  let fileNo: number | undefined
  let through = 0
  const match = MERGE_UNIT.exec(unit)
  if (match) {
    fileNo = Number(match[1])
    through = match[3] ? Number.POSITIVE_INFINITY : Number(match[2])
  } else if (state.progress?.file_no !== undefined) {
    fileNo = state.progress.file_no
    through =
      state.progress.pass === 2 ? Number.POSITIVE_INFINITY : (state.progress.through_row ?? 0)
  }
  if (fileNo === undefined) return 0
  let done = 0
  for (const file of ordered) {
    if (file.file_no === fileNo) {
      done += Math.min(through, file.rows_total)
      break
    }
    done += file.rows_total
  }
  return Math.min(1, done / total)
}

/* ------------------------------------------------------------------------------------------ */
/* Client                                                                                       */
/* ------------------------------------------------------------------------------------------ */

export type ImportClientOptions = {
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  /** Cancels every request and wait of this client. */
  signal?: AbortSignal
  /** Base path of the route handlers (tests). */
  basePath?: string
}

type JsonBody = Record<string, unknown>

export type StageProgress = {
  /** The chunk (or piece) just staged. */
  result: StageResult
  /** Rows of the file staged so far (the last staged row). */
  through: number
}

export type ImportClient = ReturnType<typeof createImportClient>

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function createImportClient(options: ImportClientOptions = {}) {
  const fetchImpl = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const signal = options.signal
  const sleep = options.sleep ?? ((ms: number) => defaultSleep(ms, signal))
  const random = options.random ?? Math.random
  const base = options.basePath ?? '/api/imports'

  async function toApiError(response: Response): Promise<ImportApiError> {
    let code = `http_${response.status}`
    let hint: string | null = null
    let message = response.statusText || code
    try {
      const body = (await response.json()) as { code?: unknown; hint?: unknown; message?: unknown }
      if (typeof body.code === 'string' && body.code !== '') code = body.code
      if (typeof body.hint === 'string' && body.hint !== '') hint = body.hint
      if (typeof body.message === 'string' && body.message !== '') message = body.message
    } catch {
      // Not JSON (a proxy error page, say): the status decides.
    }
    return new ImportApiError(
      response.status,
      code,
      hint,
      message,
      parseRetryAfter(response.headers.get('retry-after')),
    )
  }

  /** One request; throws ImportApiError for anything but 2xx. */
  async function send<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: JsonBody | string,
  ): Promise<{ status: number; body: T }> {
    const headers: Record<string, string> = { accept: 'application/json' }
    let payload: string | undefined
    if (body !== undefined) {
      headers['content-type'] = 'application/json'
      payload = typeof body === 'string' ? body : JSON.stringify(body)
    }
    let response: Response
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        headers,
        body: payload,
        cache: 'no-store',
        credentials: 'same-origin',
        signal,
      })
    } catch (error) {
      if (isAbort(error) || signal?.aborted) throw error
      throw new ImportApiError(0, 'network', null, error instanceof Error ? error.message : 'fetch')
    }
    // The routes never redirect; a followed redirect is the sign-in page of an expired session.
    if (response.redirected) {
      throw new ImportApiError(401, 'MQ401', null, 'The session has expired')
    }
    if (!response.ok) throw await toApiError(response)
    const text = response.status === 204 ? '' : await response.text()
    return { status: response.status, body: (text === '' ? undefined : JSON.parse(text)) as T }
  }

  /**
   * Retries busy answers (jittered back-off) and network failures (a few times). Only for calls
   * the server treats idempotently.
   */
  async function withRetries<T>(call: () => Promise<T>): Promise<T> {
    let busy = 0
    let network = 0
    for (;;) {
      try {
        return await call()
      } catch (error) {
        if (isBusyError(error) && busy < MAX_BUSY_RETRIES) {
          const wait = Math.max(
            backoffMs(busy, random),
            (error as ImportApiError).retryAfterMs ?? 0,
          )
          busy += 1
          await sleep(Math.min(wait, 10_000))
          continue
        }
        if (isNetworkError(error) && network < MAX_NETWORK_RETRIES) {
          network += 1
          await sleep(backoffMs(network, random))
          continue
        }
        throw error
      }
    }
  }

  const batchPath = (batchId: string) => `/${encodeURIComponent(batchId)}`
  const filePath = (batchId: string, fileNo: number) =>
    `${batchPath(batchId)}/files/${encodeURIComponent(String(fileNo))}`

  /** `POST /api/imports`: creates the batch (idempotent on the batch id and manifest). */
  function createImport(input: {
    batchId: string
    organizationId: string
    files: readonly FileManifest[]
  }): Promise<CreateResult> {
    return withRetries(async () => {
      const { body } = await send<CreateResult>('POST', '', {
        batch_id: input.batchId,
        organization_id: input.organizationId,
        files: input.files,
      })
      return body
    })
  }

  function envelope(chunk: Chunk): string {
    return JSON.stringify({ rows: chunkBody(chunk) })
  }

  /** Sends one chunk exactly as it is (busy and network retries only). */
  function putChunk(batchId: string, fileNo: number, chunk: Chunk, body: string) {
    return withRetries(async () => {
      const { body: result } = await send<StageResult>(
        'PUT',
        `${filePath(batchId, fileNo)}/chunks/${encodeURIComponent(String(chunk.firstRow))}`,
        body,
      )
      return result
    })
  }

  /**
   * Stages one chunk: split while its envelope is over the request cap, halved after a timeout
   * (both halves sent, in order). Calls `onStaged` for every piece the server accepted and
   * returns the size (rows) that worked, which later chunks of the file should not exceed.
   */
  async function stageChunk(
    batchId: string,
    fileNo: number,
    chunk: Chunk,
    onStaged?: (result: StageResult) => void,
  ): Promise<{ results: StageResult[]; maxRows: number }> {
    const results: StageResult[] = []
    let maxRows = chunk.rows.length
    const queue: Chunk[] = [chunk]
    while (queue.length > 0) {
      const piece = queue.shift() as Chunk
      const body = envelope(piece)
      if (piece.bytes > MAX_CHUNK_TEXT_BYTES || utf8Length(body) > MAX_REQUEST_BYTES) {
        const halves = halveChunk(piece)
        if (!halves) {
          throw new ImportApiError(413, 'too_large', null, `Row ${piece.firstRow} is too large`)
        }
        queue.unshift(...halves)
        continue
      }
      try {
        const result = await putChunk(batchId, fileNo, piece, body)
        results.push(result)
        onStaged?.(result)
      } catch (error) {
        if (!isTimeoutError(error)) throw error
        const halves = halveChunk(piece)
        if (!halves) throw error
        maxRows = Math.min(maxRows, halves[0].rows.length)
        queue.unshift(...halves)
      }
    }
    return { results, maxRows }
  }

  /**
   * Stages a file from a stream of chunks (the parser's `ChunkStream`), one request at a time.
   * After a timeout, later chunks go in pieces no larger than the size that worked.
   */
  async function stageFile(input: {
    batchId: string
    fileNo: number
    chunks: AsyncIterable<{ chunk: Chunk }>
    onProgress?: (progress: StageProgress) => void
  }): Promise<StageResult | null> {
    let pieceRows = Number.POSITIVE_INFINITY
    let last: StageResult | null = null
    for await (const event of input.chunks) {
      const pieces = Number.isFinite(pieceRows) ? splitChunk(event.chunk, pieceRows) : [event.chunk]
      for (const piece of pieces) {
        const { maxRows } = await stageChunk(input.batchId, input.fileNo, piece, (result) => {
          last = result
          input.onProgress?.({ result, through: result.last_row })
        })
        if (maxRows < piece.rows.length) pieceRows = Math.min(pieceRows, maxRows)
      }
    }
    return last
  }

  /** `POST …/seal`: idempotent once sealed. */
  function sealFile(batchId: string, fileNo: number, rowsTotal: number): Promise<SealResult> {
    return withRetries(async () => {
      const { body } = await send<SealResult>('POST', `${filePath(batchId, fileNo)}/seal`, {
        rows_total: rowsTotal,
      })
      return body
    })
  }

  /**
   * PUTs the original file to its signed Storage URL. Never throws for a failed upload (the copy
   * is for the audit trail only); resolves true when Storage accepted it.
   */
  async function uploadOriginal(
    file: Blob,
    uploadUrl: string,
    upload: { contentType: string; apikey?: string },
  ): Promise<boolean> {
    const headers: Record<string, string> = { 'content-type': upload.contentType }
    if (upload.apikey) headers.apikey = upload.apikey
    try {
      const response = await fetchImpl(uploadUrl, {
        method: 'PUT',
        headers,
        body: file,
        cache: 'no-store',
        credentials: 'omit',
        signal,
      })
      return response.ok
    } catch (error) {
      if (isAbort(error) || signal?.aborted) throw error
      return false
    }
  }

  /** One `POST …/commit` (the route loops steps for up to 20 s; 202 means call again). */
  async function commitStep(batchId: string, maxRows?: number) {
    const { status, body } = await send<CommitResult>(
      'POST',
      `${batchPath(batchId)}/commit`,
      maxRows === undefined ? {} : { max_rows: maxRows },
    )
    return { status, result: body }
  }

  /**
   * Commits until the server says done (200, or `done` in the body). Busy answers back off. A
   * timeout of a stepped commit halves `max_rows` (from 5,000 down to 100); an all-at-once commit
   * (at most 5,000 staged rows, which ignores `max_rows`) is retried once and then reported, since
   * every retry re-runs the whole commit. `known` is what the caller knows of the batch before the
   * first answer. Returns the last state: check `status`, which is `succeeded`, or `failed` /
   * `invalid` / `expired` when the commit stopped.
   */
  async function commit(
    batchId: string,
    onProgress?: (result: CommitResult) => void,
    known?: CommitHint | null,
  ): Promise<CommitResult> {
    let maxRows: number | undefined
    let busy = 0
    let network = 0
    let atomicTimeouts = 0
    let last: CommitHint | null = known ?? null
    for (;;) {
      try {
        const { status, result } = await commitStep(batchId, maxRows)
        busy = 0
        network = 0
        last = result
        onProgress?.(result)
        if (status === 200 || result.done) return result
      } catch (error) {
        if (isTimeoutError(error) && !isSteppedCommit(last)) {
          if (atomicTimeouts >= MAX_ATOMIC_TIMEOUT_RETRIES) throw error
          atomicTimeouts += 1
          await sleep(Math.min((error as ImportApiError).retryAfterMs ?? 1_000, 5_000))
          continue
        }
        if (isTimeoutError(error) && (maxRows ?? Infinity) > MIN_COMMIT_ROWS) {
          maxRows = Math.max(MIN_COMMIT_ROWS, Math.floor((maxRows ?? LARGEST_MERGE_ROWS) / 2))
          await sleep(Math.min((error as ImportApiError).retryAfterMs ?? 1_000, 5_000))
          continue
        }
        if (isBusyError(error) && busy < MAX_BUSY_RETRIES) {
          const wait = Math.max(
            backoffMs(busy, random),
            (error as ImportApiError).retryAfterMs ?? 0,
          )
          busy += 1
          await sleep(Math.min(wait, 10_000))
          continue
        }
        if (isNetworkError(error) && network < MAX_NETWORK_RETRIES) {
          network += 1
          await sleep(backoffMs(network, random))
          continue
        }
        throw error
      }
    }
  }

  /** `POST …/resume`: a failed stepped commit goes back to committing (call `commit` next). */
  function resume(batchId: string): Promise<BatchState> {
    return withRetries(async () => {
      const { body } = await send<BatchState>('POST', `${batchPath(batchId)}/resume`, {})
      return body
    })
  }

  /** Cancels (or abandons) an import: repeats `POST …/cancel` until staging is cleared. */
  async function cancel(
    batchId: string,
    onProgress?: (result: CancelResult) => void,
  ): Promise<CancelResult> {
    for (let round = 0; ; round += 1) {
      const result = await withRetries(async () => {
        const { body } = await send<CancelResult>('POST', `${batchPath(batchId)}/cancel`, {})
        return body
      })
      onProgress?.(result)
      if (result.done || round >= 500) return result
    }
  }

  /** `DELETE /api/imports/{id}` (finished, canceled or expired imports). */
  async function deleteImport(batchId: string): Promise<void> {
    await withRetries(() => send<unknown>('DELETE', batchPath(batchId), {}))
  }

  /** `GET /api/imports/{id}`: the batch and the current state of every file (errors included). */
  function getImport(batchId: string): Promise<ImportStatusResult> {
    return withRetries(async () => {
      const { body } = await send<ImportStatusResult>('GET', batchPath(batchId))
      return body
    })
  }

  return {
    getImport,
    createImport,
    stageChunk,
    stageFile,
    sealFile,
    uploadOriginal,
    commitStep,
    commit,
    resume,
    cancel,
    deleteImport,
  }
}

/** Links the pages render (plain GETs; the route handlers set the download headers). */
export const importLinks = {
  template: (entity: EntityName) => `/api/imports/templates/${encodeURIComponent(entity)}`,
  errorReport: (batchId: string) => `/api/imports/${encodeURIComponent(batchId)}/errors`,
  original: (batchId: string, fileNo: number) =>
    `/api/imports/${encodeURIComponent(batchId)}/files/${encodeURIComponent(String(fileNo))}/original`,
}
