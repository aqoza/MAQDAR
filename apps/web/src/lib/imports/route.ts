/**
 * Plumbing shared by the import route handlers (`src/app/api/imports/**`). The handlers are thin
 * pass-throughs: they check the request (same origin, JSON, a streaming body cap), call one RPC
 * with the user's cookie session and return its jsonb result unchanged, or `{code, hint?,
 * message?}` with an HTTP status derived from the SQLSTATE. Every validation rule lives in SQL.
 *
 * Pure module (web APIs only, no server or Next.js imports), so Vitest covers it directly; the
 * session part lives in `route-auth.ts`.
 */
import type { RpcErrorLike } from '../rpc-errors'

/** Per-user data: never stored by the browser, a CDN or the Workers cache. */
export const NO_STORE = 'private, no-store'

/** Body cap of the JSON routes (create, seal, commit, resume, cancel, delete). */
export const BODY_LIMIT = 1_048_576

/** UTF-8 bytes of the chunk text `import_stage_chunk` accepts (`p_rows`). */
export const CHUNK_ROWS_LIMIT = 1_048_576

/**
 * Body cap of the chunk route. The body is `{"rows": "<chunk text>"}`, and JSON escaping turns
 * every `"` of the chunk into `\"`, so a full chunk grows by a fifth or more in transit; the cap
 * allows twice the RPC limit and the `rows` string itself is held to CHUNK_ROWS_LIMIT.
 */
export const CHUNK_BODY_LIMIT = 2 * CHUNK_ROWS_LIMIT + 1_024

/** Wall time the commit and cancel routes keep calling their step RPC before answering 202. */
export const STEP_BUDGET_MS = 20_000

/** Seconds a client waits before retrying after a statement timeout (503). */
export const TIMEOUT_RETRY_AFTER_SECONDS = 5

/** Seconds a client waits before retrying a lock conflict (409 busy or import_in_progress). */
export const BUSY_RETRY_AFTER_SECONDS = 2

/** Highest value of a Postgres integer argument. */
export const INT4_MAX = 2_147_483_647

/** Highest `file_no` of an import (import_files.file_no). */
export const MAX_FILE_NO = 60

/** The private Storage bucket of the originals (`<organization_id>/<batch_id>/<file_no>.<ext>`). */
export const IMPORTS_BUCKET = 'imports'

/** Lifetime of the signed download URL of an original, in seconds. */
export const ORIGINAL_URL_SECONDS = 60

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Error body of every import route. `code` is an RpcErrors key or one of ROUTE_ERROR_CODES. */
export type RouteErrorBody = {
  code: string
  hint?: string
  message?: string
  request_id?: string
}

/** Codes the routes produce themselves (the others are SQLSTATEs or RpcErrors keys). */
export const ROUTE_ERROR_CODES = [
  'bad_request',
  'cross_origin',
  'payload_too_large',
  'unsupported_media_type',
] as const

/* ------------------------------------------------------------------------------------------ */
/* Responses                                                                                    */
/* ------------------------------------------------------------------------------------------ */

/** Headers with `Cache-Control: private, no-store` plus `extra`. */
export function noStoreHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra)
  headers.set('Cache-Control', NO_STORE)
  return headers
}

export function jsonResponse(body: unknown, status = 200, extra?: HeadersInit): Response {
  const headers = noStoreHeaders(extra)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(body ?? null), { status, headers })
}

export function errorResponse(status: number, body: RouteErrorBody, extra?: HeadersInit): Response {
  return jsonResponse(body, status, extra)
}

export function badRequest(hint?: string): Response {
  return errorResponse(400, hint ? { code: 'bad_request', hint } : { code: 'bad_request' })
}

/** A redirect that is never cached (Response.redirect has immutable headers). */
export function redirectResponse(location: string, status = 302): Response {
  return new Response(null, { status, headers: noStoreHeaders({ Location: location }) })
}

/* ------------------------------------------------------------------------------------------ */
/* Request checks                                                                               */
/* ------------------------------------------------------------------------------------------ */

function originOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const origin = new URL(url).origin
    return origin === 'null' ? null : origin
  } catch {
    return null
  }
}

/**
 * Whether the request's `Origin` is this deployment: the request URL's own origin, or the
 * configured site origin (NEXT_PUBLIC_SITE_URL). Browsers send `Origin` on every POST, PUT and
 * DELETE fetch, so a missing or opaque (`null`) origin is refused as well.
 */
export function isSameOrigin(
  request: Request,
  siteUrl: string | undefined = process.env.NEXT_PUBLIC_SITE_URL,
): boolean {
  const origin = request.headers.get('origin')
  if (!origin || origin === 'null') return false
  const allowed = [originOf(request.url), originOf(siteUrl)].filter(Boolean)
  return allowed.includes(origin.replace(/\/$/, ''))
}

/** `application/json`, optionally with parameters (`; charset=utf-8`), in any case. */
export function isJsonContentType(value: string | null): boolean {
  if (!value) return false
  return value.split(';')[0]?.trim().toLowerCase() === 'application/json'
}

/** UTF-8 byte length of a string without encoding it. Lone surrogates count as U+FFFD (3). */
export function utf8ByteLength(text: string): number {
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i)
    if (unit < 0x80) bytes += 1
    else if (unit < 0x800) bytes += 2
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        i++
      } else bytes += 3
    } else bytes += 3
  }
  return bytes
}

export type BodyResult = { ok: true; text: string } | { ok: false; response: Response }

/**
 * Reads the body as UTF-8 text, refusing (413) as soon as it exceeds `maxBytes`, whether or not
 * the client declared a Content-Length. Invalid UTF-8 is a 400.
 */
export async function readBodyText(request: Request, maxBytes: number): Promise<BodyResult> {
  const tooLarge = () => ({
    ok: false as const,
    response: errorResponse(413, { code: 'payload_too_large', hint: 'body' }),
  })
  const declared = request.headers.get('content-length')
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > maxBytes) return tooLarge()
  if (!request.body) return { ok: true, text: '' }

  const reader = request.body.getReader()
  const parts: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      return tooLarge()
    }
    parts.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.byteLength
  }
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  } catch {
    return { ok: false, response: badRequest('body') }
  }
}

export type JsonBody = Record<string, unknown>

/** A JSON object; an empty body counts as `{}`. Arrays, scalars and invalid JSON are refused. */
export function parseJsonObject(text: string): JsonBody | null {
  if (text.trim() === '') return {}
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as JsonBody)
      : null
  } catch {
    return null
  }
}

export type MutationGuard = { ok: true; body: JsonBody } | { ok: false; response: Response }

const ROWS_ENVELOPE_PREFIX = '{"rows":"'

/**
 * The JSON string literal of a chunk body sent exactly as the client builds it,
 * `{"rows":"<chunk text, JSON-escaped>"}`, or null for any other shape. One scan checks that
 * the literal is a single string (every quote and control character inside it escaped), so it
 * can be passed on to PostgREST as `p_rows` without decoding and re-encoding a megabyte of text
 * on the Worker; PostgREST validates the escapes themselves.
 */
export function rowsLiteral(text: string): string | null {
  const start = ROWS_ENVELOPE_PREFIX.length
  const end = text.length - 2
  if (end < start || !text.startsWith(ROWS_ENVELOPE_PREFIX) || !text.endsWith('"}')) return null
  let i = start
  while (i < end) {
    const unit = text.charCodeAt(i)
    if (unit === 0x5c) {
      i += 2
      continue
    }
    if (unit === 0x22 || unit < 0x20) return null
    i += 1
  }
  // A backslash right before the closing quote would have escaped it.
  if (i !== end) return null
  return text.slice(start - 1, end + 1)
}

/** The body of the import_stage_chunk RPC around a `p_rows` literal taken from rowsLiteral. */
export function stageChunkPayload(
  batchId: string,
  fileNo: number,
  firstRow: number,
  rows: string,
): string {
  return `{"p_batch_id":${JSON.stringify(batchId)},"p_file_no":${fileNo},"p_first_row":${firstRow},"p_rows":${rows}}`
}

/**
 * The checks every state-changing import route runs before touching the session: same origin
 * (403), `Content-Type: application/json` (415), the streaming body cap (413) and a JSON object
 * body (400). Cookies alone can never trigger a write from another site: a cross-site form cannot
 * send JSON, and a cross-site fetch with JSON needs a CORS preflight that these routes never
 * answer.
 */
export async function guardMutation(
  request: Request,
  options: { maxBytes?: number; siteUrl?: string } = {},
): Promise<MutationGuard> {
  const siteUrl = 'siteUrl' in options ? options.siteUrl : process.env.NEXT_PUBLIC_SITE_URL
  if (!isSameOrigin(request, siteUrl)) {
    return { ok: false, response: errorResponse(403, { code: 'cross_origin' }) }
  }
  if (!isJsonContentType(request.headers.get('content-type'))) {
    return { ok: false, response: errorResponse(415, { code: 'unsupported_media_type' }) }
  }
  const body = await readBodyText(request, options.maxBytes ?? BODY_LIMIT)
  if (!body.ok) return body
  const parsed = parseJsonObject(body.text)
  if (!parsed) return { ok: false, response: badRequest('body') }
  return { ok: true, body: parsed }
}

/**
 * Reads the chunk route's body: the same checks as guardMutation, but a body in the client's
 * exact shape is not parsed at all (rowsLiteral scans it); any other body is parsed as JSON.
 */
export async function guardChunkBody(
  request: Request,
  options: { maxBytes: number; siteUrl?: string },
): Promise<
  | { ok: true; literal: string }
  | { ok: true; literal: null; body: JsonBody }
  | { ok: false; response: Response }
> {
  const siteUrl = 'siteUrl' in options ? options.siteUrl : process.env.NEXT_PUBLIC_SITE_URL
  if (!isSameOrigin(request, siteUrl)) {
    return { ok: false, response: errorResponse(403, { code: 'cross_origin' }) }
  }
  if (!isJsonContentType(request.headers.get('content-type'))) {
    return { ok: false, response: errorResponse(415, { code: 'unsupported_media_type' }) }
  }
  const body = await readBodyText(request, options.maxBytes)
  if (!body.ok) return body
  const literal = rowsLiteral(body.text)
  if (literal !== null) return { ok: true, literal }
  const parsed = parseJsonObject(body.text)
  if (!parsed) return { ok: false, response: badRequest('body') }
  return { ok: true, literal: null, body: parsed }
}

/* ------------------------------------------------------------------------------------------ */
/* Parameters                                                                                   */
/* ------------------------------------------------------------------------------------------ */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A canonical UUID in lower case, or null. */
export function parseUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_RE.test(value) ? value.toLowerCase() : null
}

/** A decimal integer path segment within [min, max] (no sign, no leading zeros), or null. */
export function parseIntSegment(
  value: string | undefined,
  min: number,
  max: number,
): number | null {
  if (value === undefined || !/^(0|[1-9][0-9]{0,9})$/.test(value)) return null
  const number = Number(value)
  return number >= min && number <= max ? number : null
}

/** A JSON integer within [min, max], or null. */
export function parseIntValue(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null
}

/* ------------------------------------------------------------------------------------------ */
/* RPC errors                                                                                   */
/* ------------------------------------------------------------------------------------------ */

/** HTTP status per custom MAQDAR SQLSTATE (see the tenancy and import migrations). */
const MQ_STATUS: Readonly<Record<string, number>> = {
  MQ401: 401,
  MQ403: 403,
  MQ404: 404,
  MQ409: 409,
  MQ422: 422,
  MQ429: 429,
}

/** PostgREST codes for a missing, expired or invalid JWT. */
const JWT_CODES = new Set(['PGRST301', 'PGRST302', 'PGRST303'])

export type MappedRpcError = {
  status: number
  body: RouteErrorBody
  /** Seconds for a Retry-After header. */
  retryAfter?: number
  /** Unexpected: logged with a request id. */
  unexpected: boolean
}

export function identifierHint(hint: string | null | undefined): string | undefined {
  const value = hint?.trim() ?? ''
  return /^[a-z][a-z0-9_]{0,62}$/.test(value) ? value : undefined
}

/**
 * The HTTP answer for a PostgREST / RPC error. MQ401/403/404/409/422/429 keep their code and
 * carry the RPC's hint (the offending field) and message; 57014 (statement timeout) is a 503 the
 * client retries with a smaller chunk; 55P03, 40P01 and 40001 (lock timeout, deadlock,
 * serialization) are 409 `busy`; 22P02 is a 400. Anything else is a 500 with a logged request id.
 */
export function mapRpcError(error: RpcErrorLike): MappedRpcError {
  const code = error?.code ?? ''
  const status = MQ_STATUS[code]
  if (status !== undefined) {
    const body: RouteErrorBody = { code }
    const hint = identifierHint(error?.hint)
    if (hint) body.hint = hint
    if (error?.message) body.message = error.message
    const busy = code === 'MQ409' && hint === 'import_in_progress'
    return busy
      ? { status, body, retryAfter: BUSY_RETRY_AFTER_SECONDS, unexpected: false }
      : { status, body, unexpected: false }
  }
  switch (code) {
    case '57014':
      return {
        status: 503,
        body: { code: 'timeout' },
        retryAfter: TIMEOUT_RETRY_AFTER_SECONDS,
        unexpected: false,
      }
    case '55P03':
    case '40P01':
    case '40001':
      return {
        status: 409,
        body: { code: 'busy' },
        retryAfter: BUSY_RETRY_AFTER_SECONDS,
        unexpected: false,
      }
    case '22P02':
      return { status: 400, body: { code: 'bad_request' }, unexpected: false }
    case '42501':
      return { status: 403, body: { code: '42501' }, unexpected: false }
    default:
      if (JWT_CODES.has(code)) return { status: 401, body: { code: 'MQ401' }, unexpected: false }
      return { status: 500, body: { code: 'generic' }, unexpected: true }
  }
}

export type Logger = Pick<Console, 'error'>

/**
 * The error response for an RPC failure. Unexpected errors get a request id in the body and the
 * `X-Request-Id` header, and are logged with the route, the SQLSTATE and the message only (never
 * the request body).
 */
export function rpcErrorResponse(
  error: RpcErrorLike,
  route: string,
  logger: Logger = console,
): Response {
  const mapped = mapRpcError(error)
  const headers = new Headers()
  if (mapped.retryAfter !== undefined) headers.set('Retry-After', String(mapped.retryAfter))
  if (mapped.unexpected) {
    const requestId = crypto.randomUUID()
    headers.set('X-Request-Id', requestId)
    logger.error('imports route failed', {
      request_id: requestId,
      route,
      code: error?.code ?? null,
      message: error?.message ?? null,
    })
    return errorResponse(mapped.status, { ...mapped.body, request_id: requestId }, headers)
  }
  return errorResponse(mapped.status, mapped.body, headers)
}

/** A thrown exception (network failure, bug) as a logged 500. */
export function unexpectedErrorResponse(
  error: unknown,
  route: string,
  logger: Logger = console,
): Response {
  const message = error instanceof Error ? error.message : String(error)
  return rpcErrorResponse({ code: 'exception', message }, route, logger)
}

/* ------------------------------------------------------------------------------------------ */
/* Step loops (commit, cancel)                                                                  */
/* ------------------------------------------------------------------------------------------ */

export type StepResult<T> = { data: T | null; error: RpcErrorLike | null }

export type StepLoopOutcome<T> = {
  /** The last successful result. */
  last: T | null
  /** The error to report; null when `last` is the answer. */
  error: RpcErrorLike | null
  done: boolean
  steps: number
}

/** Lock conflicts worth retrying at once: another step, a delete or a deadlock got in between. */
export function isRetryableStepError(error: RpcErrorLike): boolean {
  const code = error?.code ?? ''
  if (code === '40P01' || code === '55P03' || code === '40001') return true
  return code === 'MQ409' && identifierHint(error?.hint) === 'import_in_progress'
}

export type StepLoopOptions = {
  budgetMs?: number
  /** Pauses before retrying a lock conflict; their count caps consecutive retries. */
  retryDelaysMs?: readonly number[]
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Calls `step` until `isDone` says so or the wall-time budget would be exceeded by another step
 * as long as the last one. Lock conflicts are retried after a short pause. An error after at
 * least one successful step that a later call can get past (a lock conflict or a statement
 * timeout) ends the loop with the last result instead, so the client sees progress and repeats.
 */
export async function runSteps<T>(
  step: () => PromiseLike<StepResult<T>>,
  isDone: (result: T) => boolean,
  options: StepLoopOptions = {},
): Promise<StepLoopOutcome<T>> {
  const budget = options.budgetMs ?? STEP_BUDGET_MS
  const delays = options.retryDelaysMs ?? [150, 400, 1_000]
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? defaultSleep
  const started = now()
  let last: T | null = null
  let steps = 0
  let retries = 0
  let lastDuration = 0

  for (;;) {
    const stepStarted = now()
    const { data, error } = await step()
    if (error) {
      const delay = delays[retries]
      if (
        isRetryableStepError(error) &&
        delay !== undefined &&
        now() - started + delay + lastDuration <= budget
      ) {
        retries += 1
        await sleep(delay)
        continue
      }
      const transient = isRetryableStepError(error) || error.code === '57014'
      if (last !== null && transient) return { last, error: null, done: false, steps }
      return { last, error, done: false, steps }
    }
    if (data === null || data === undefined) {
      return {
        last,
        error: { code: 'empty_result', message: 'the step returned nothing' },
        done: false,
        steps,
      }
    }
    retries = 0
    steps += 1
    last = data
    lastDuration = now() - stepStarted
    if (isDone(data)) return { last, error: null, done: true, steps }
    if (now() - started + lastDuration > budget) return { last, error: null, done: false, steps }
  }
}

/** `done` of a step RPC result (import_commit_step, import_cancel_step). */
export function stepIsDone(result: unknown): boolean {
  return (
    typeof result === 'object' && result !== null && (result as { done?: unknown }).done === true
  )
}

/* ------------------------------------------------------------------------------------------ */
/* Downloads                                                                                    */
/* ------------------------------------------------------------------------------------------ */

/** RFC 5987 `ext-value` characters (attr-char), everything else percent-encoded. */
function rfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/**
 * `Content-Disposition: attachment` with an ASCII `filename` fallback and the exact name in an
 * RFC 5987 `filename*` (Arabic names survive). Quotes, backslashes, control characters and path
 * separators never reach the header.
 */
export function attachmentDisposition(fileName: string): string {
  const clean = fileName.replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim() || 'download'
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_').replace(/["%;]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${rfc5987(clean)}`
}

/* ------------------------------------------------------------------------------------------ */
/* Error report                                                                                 */
/* ------------------------------------------------------------------------------------------ */

/** Columns of the downloadable error report (machine names, stable across languages). */
export const ERROR_REPORT_HEADER = [
  'file',
  'row',
  'column',
  'code',
  'level',
  'value',
  'message',
] as const

/** Rows per keyset page of the error report. */
export const ERROR_REPORT_PAGE = 1_000

/** One import_errors row as the report reads it. */
export type ImportErrorRow = {
  id: number
  file_no: number
  row_no: number
  column_name: string
  code: string
  level: string
  value: string | null
  detail: unknown
}

/** ICU arguments (next-intl takes strings, numbers and dates; booleans become text). */
export type MessageValues = Record<string, string | number>

/**
 * Values an error message may use: the file, row, column and value, plus the scalar fields of
 * the error's detail (`first_row`, `expected`, `actual`, `storage_path`, `phase`, …) and the
 * stored values a two-column rule compared with, as `stored_<column>`.
 */
export function errorMessageValues(row: ImportErrorRow, fileName: string): MessageValues {
  const values: MessageValues = {}
  const add = (key: string, value: unknown) => {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(key)) return
    if (typeof value === 'string') values[key] = value
    else if (typeof value === 'boolean') values[key] = String(value)
    else if (typeof value === 'number' && Number.isFinite(value)) values[key] = value
  }
  if (isRecord(row.detail)) {
    for (const [key, value] of Object.entries(row.detail)) {
      if (key === 'stored' && isRecord(value)) {
        for (const [column, stored] of Object.entries(value)) add(`stored_${column}`, stored)
      } else add(key, value)
    }
  }
  values.file = fileName
  values.row = row.row_no
  values.column = row.column_name
  values.value = row.value ?? ''
  return values
}

/** What the report needs from a next-intl translator of the ImportErrors namespace. */
export type ErrorMessageSource = {
  has: (code: string) => boolean
  raw: (code: string) => unknown
  format: (code: string, values?: MessageValues) => string
}

/**
 * Translates error codes for the report. A message without placeholders is formatted once per
 * code; one with placeholders is formatted per row with errorMessageValues. An unknown code, or a
 * message that fails to format, falls back to the code itself.
 */
export function errorMessageFormatter(
  source: ErrorMessageSource,
  namespace = 'ImportErrors',
): (row: ImportErrorRow, fileName: string) => string {
  const constant = new Map<string, string>()
  const parametric = new Set<string>()
  const safeFormat = (code: string, values?: MessageValues) => {
    try {
      const text = source.format(code, values)
      // next-intl answers a formatting error with getMessageFallback: "<namespace>.<key>".
      return text === `${namespace}.${code}` || text === code ? code : text
    } catch {
      return code
    }
  }
  return (row, fileName) => {
    const known = constant.get(row.code)
    if (known !== undefined) return known
    if (!parametric.has(row.code)) {
      const raw = source.has(row.code) ? source.raw(row.code) : undefined
      if (typeof raw !== 'string') {
        constant.set(row.code, row.code)
        return row.code
      }
      if (!raw.includes('{')) {
        const text = safeFormat(row.code)
        constant.set(row.code, text)
        return text
      }
      parametric.add(row.code)
    }
    return safeFormat(row.code, errorMessageValues(row, fileName))
  }
}

/**
 * One report line: file name ('' for batch-level errors), data row number ('' for errors about
 * a whole file; 1 is the first row after the header), column, code, level, value and message.
 */
/** What the report needs of a file to say how many details were not stored. */
export type ReportFile = {
  file_no: number
  original_name: string
  error_count: number
  warning_count: number
  errors_stored: number
  error_counts: unknown
}

/**
 * Closing lines of the report: one per file whose errors and warnings outnumber the stored
 * details (at most 10,000 per file are kept), with how many are not listed and the complete
 * totals per code, so a downloaded report never looks complete when it is not.
 */
export function unlistedReportLines(
  files: readonly ReportFile[],
  message: (values: { count: number; codes: string }) => string,
): (string | number)[][] {
  return [...files]
    .sort((a, b) => a.file_no - b.file_no)
    .flatMap((file) => {
      const count = file.error_count + file.warning_count - file.errors_stored
      if (count <= 0) return []
      const totals = new Map<string, number>()
      if (isRecord(file.error_counts)) {
        for (const [code, columns] of Object.entries(file.error_counts)) {
          if (!isRecord(columns)) continue
          for (const value of Object.values(columns)) {
            if (typeof value === 'number' && Number.isFinite(value)) {
              totals.set(code, (totals.get(code) ?? 0) + value)
            }
          }
        }
      }
      const codes = [...totals]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([code, total]) => `${code}: ${total}`)
        .join(', ')
      return [[file.original_name, '', '', '', '', '', message({ count, codes })]]
    })
}

export function errorReportFields(
  row: ImportErrorRow,
  fileName: string,
  message: string,
): (string | number)[] {
  return [
    fileName,
    row.row_no > 0 ? row.row_no : '',
    row.column_name,
    row.code,
    row.level,
    row.value ?? '',
    message,
  ]
}
