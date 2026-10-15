import { identifierHint } from '../imports/route'
import type { RpcErrorLike } from '../rpc-errors'
import type { ApiScope } from './auth'
import type { ParameterIssue, ListQueryFailure } from './cursor'
import {
  POINTER_PATTERN,
  REQUEST_ERROR_CODES,
  errorText,
  pointerToken,
  recordPointer,
  type RequestErrorCode,
} from './errors'
import { API_LIMITS } from './limits'
import type { RequestIssue, UpsertBodyFailure } from './records'

/**
 * RFC 9457 problems of `/api/v1`. Every error answer is `application/problem+json` with
 * `type: urn:maqdar:problem:<code>`, a stable `title`, `status` (the HTTP status), `detail`,
 * `instance: urn:uuid:<request id>`, `code` and `request_id`, plus the extension members listed
 * per code. Problems carry codes, the caller's own values (at most 200 characters) and the request
 * id: never SQL text, SQLSTATEs, the 5a `phase` or stack traces. Pure module.
 */

export const PROBLEMS = {
  invalid_parameter: {
    status: 400,
    title: 'Invalid query parameter',
    detail: 'A query parameter is unknown, repeated or not valid; see errors.',
  },
  invalid_cursor: {
    status: 400,
    title: 'Invalid cursor',
    detail:
      'The cursor is not valid for this list and these filters; start again without a cursor.',
  },
  invalid_json: {
    status: 400,
    title: 'Invalid JSON',
    detail: 'The body is not valid UTF-8 JSON, or holds a value the database cannot store.',
  },
  unauthorized: {
    status: 401,
    title: 'Authentication required',
    detail: 'Send an API key as Authorization: Bearer <key>.',
  },
  invalid_token: {
    status: 401,
    title: 'Invalid API key',
    detail: 'The API key is not valid.',
  },
  insufficient_scope: {
    status: 403,
    title: 'Insufficient scope',
    detail: 'The API key does not have the scope this operation needs.',
  },
  not_found: {
    status: 404,
    title: 'Not found',
    detail: 'There is no such API endpoint or resource.',
  },
  method_not_allowed: {
    status: 405,
    title: 'Method not allowed',
    detail: 'This endpoint does not answer this method; see the Allow header.',
  },
  import_in_progress: {
    status: 409,
    title: 'Write in progress',
    detail:
      'Another write or import of this organization is in progress; retry after the Retry-After delay.',
  },
  busy: {
    status: 409,
    title: 'Busy',
    detail: 'The data is locked by another operation; retry after the Retry-After delay.',
  },
  write_conflict: {
    status: 409,
    title: 'Write conflict',
    detail: 'The data changed between the check and the write, so nothing was saved; retry.',
  },
  payload_too_large: {
    status: 413,
    title: 'Payload too large',
    detail: `The body is larger than ${API_LIMITS.bodyBytes} bytes.`,
  },
  too_many_records: {
    status: 413,
    title: 'Too many records',
    detail: 'The request carries more records than one upsert may; split it.',
  },
  unsupported_media_type: {
    status: 415,
    title: 'Unsupported media type',
    detail: 'Send Content-Type: application/json, without Content-Encoding.',
  },
  invalid_request: {
    status: 422,
    title: 'Invalid request',
    detail: 'The body does not follow the request rules, so nothing was saved; see errors.',
  },
  validation_failed: {
    status: 422,
    title: 'Validation failed',
    detail: 'Some records are not valid, so nothing was saved; see errors.',
  },
  rate_limited: {
    status: 429,
    title: 'Too many requests',
    detail: 'Too many requests for this key or address; retry after the Retry-After delay.',
  },
  daily_limit: {
    status: 429,
    title: 'Daily write limit reached',
    detail: `The organization made ${API_LIMITS.recordedWritesPerDay} recorded writes in the last 24 hours.`,
  },
  internal_error: {
    status: 500,
    title: 'Internal error',
    detail: 'Something went wrong on our side. Quote the request id when you contact support.',
  },
  timeout: {
    status: 503,
    title: 'Timeout',
    detail: 'The operation took too long; retry, with fewer records for a write.',
  },
  unavailable: {
    status: 503,
    title: 'Service unavailable',
    detail: 'The database could not be reached; retry after the Retry-After delay.',
  },
} as const satisfies Record<string, { status: number; title: string; detail: string }>

export type ProblemCode = keyof typeof PROBLEMS

export const PROBLEM_CODES = Object.keys(PROBLEMS) as ProblemCode[]

export function isProblemCode(value: unknown): value is ProblemCode {
  return typeof value === 'string' && Object.hasOwn(PROBLEMS, value)
}

/** `type` of a problem. */
export function problemType(code: ProblemCode): string {
  return `urn:maqdar:problem:${code}`
}

/** Seconds of the Retry-After header per situation. */
export const RETRY_AFTER_SECONDS = {
  busy: 2,
  write_conflict: 2,
  import_in_progress: 5,
  /** A wizard's stepped commit holds the committing slot between steps. */
  another_commit: 30,
  rate_limited: API_LIMITS.rateLimitWindowSeconds,
  daily_limit: 3_600,
  timeout: 5,
  unavailable: 5,
} as const

export const AUTH_REALM = 'maqdar-api'

/** `WWW-Authenticate` per RFC 6750 §3. */
export function wwwAuthenticate(
  error?: 'invalid_token' | 'insufficient_scope',
  scope?: ApiScope | null,
): string {
  let value = `Bearer realm="${AUTH_REALM}"`
  if (error) value += `, error="${error}"`
  if (error === 'insufficient_scope' && scope) value += `, scope="${scope}"`
  return value
}

export type ProblemBody = {
  type: string
  title: string
  status: number
  detail: string
  instance: string
  code: ProblemCode
  request_id: string
  [extension: string]: unknown
}

/** A problem ready to send: status, headers that belong to it, and the body. */
export type ApiProblem = {
  status: number
  headers: Record<string, string>
  body: ProblemBody
}

export type ProblemInit = {
  /** Overrides the code's standard detail. */
  detail?: string
  /** Extension members (reserved members cannot be overridden). */
  extensions?: Record<string, unknown>
  /** Seconds for Retry-After instead of the code's default. */
  retryAfter?: number
  /** The Allow header of a 405. */
  allow?: string
  /** The scope a 403 names (`required_scope` and WWW-Authenticate). */
  requiredScope?: ApiScope | null
}

const RESERVED = new Set(['type', 'title', 'status', 'detail', 'instance', 'code', 'request_id'])

/** Keys that never appear in a problem, at any depth (defence in depth for J3). */
const FORBIDDEN_KEYS = new Set(['sqlstate', 'message', 'phase', 'stack'])

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6) return null
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1))
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      if (!FORBIDDEN_KEYS.has(key)) out[key] = scrub(item, depth + 1)
    }
    return out
  }
  return value
}

function defaultRetryAfter(code: ProblemCode): number | undefined {
  return Object.hasOwn(RETRY_AFTER_SECONDS, code)
    ? RETRY_AFTER_SECONDS[code as keyof typeof RETRY_AFTER_SECONDS]
    : undefined
}

/** Builds the problem for `code`, with its standard headers (WWW-Authenticate, Retry-After, Allow). */
export function toProblem(
  code: ProblemCode,
  requestId: string,
  init: ProblemInit = {},
): ApiProblem {
  const entry = PROBLEMS[code]
  const headers: Record<string, string> = {}
  if (code === 'unauthorized') headers['WWW-Authenticate'] = wwwAuthenticate()
  if (code === 'invalid_token') headers['WWW-Authenticate'] = wwwAuthenticate('invalid_token')
  if (code === 'insufficient_scope') {
    headers['WWW-Authenticate'] = wwwAuthenticate('insufficient_scope', init.requiredScope)
  }
  const retryAfter = init.retryAfter ?? defaultRetryAfter(code)
  if (retryAfter !== undefined) headers['Retry-After'] = String(retryAfter)
  if (code === 'method_not_allowed' && init.allow) headers.Allow = init.allow

  const body: ProblemBody = {
    type: problemType(code),
    title: entry.title,
    status: entry.status,
    detail: init.detail ?? entry.detail,
    instance: `urn:uuid:${requestId}`,
    code,
    request_id: requestId,
  }
  if (code === 'insufficient_scope' && init.requiredScope) {
    body.required_scope = init.requiredScope
  }
  for (const [key, value] of Object.entries(init.extensions ?? {})) {
    if (!RESERVED.has(key) && !FORBIDDEN_KEYS.has(key) && value !== undefined) {
      body[key] = scrub(value)
    }
  }
  return { status: entry.status, headers, body }
}

/* ------------------------------------------------------------------------------------------ */
/* Worker-side checks                                                                           */
/* ------------------------------------------------------------------------------------------ */

/**
 * The problem for a refused body read (`readBodyText` from `src/lib/imports/route.ts`): its 413
 * is `payload_too_large`, its 400 (invalid UTF-8) is `invalid_json`.
 */
export function bodyReadProblem(status: number, requestId: string): ApiProblem {
  return status === 413
    ? toProblem('payload_too_large', requestId, { extensions: { limit: API_LIMITS.bodyBytes } })
    : toProblem('invalid_json', requestId)
}

/** The problem for a failed `validateUpsertBody`. */
export function requestProblem(failure: UpsertBodyFailure, requestId: string): ApiProblem {
  if (failure.code === 'too_many_records') {
    return toProblem('too_many_records', requestId, {
      detail: `The request carries ${failure.records} records; one upsert takes at most ${failure.limit}.`,
      extensions: { limit: failure.limit, records: failure.records },
    })
  }
  return toProblem('invalid_request', requestId, {
    extensions: {
      error_count: failure.errorCount,
      errors: failure.errors,
      errors_truncated: failure.truncated,
    },
  })
}

/** The problem for a failed `parseListQuery`. */
export function parameterProblem(failure: ListQueryFailure, requestId: string): ApiProblem {
  return toProblem(failure.code, requestId, { extensions: { errors: failure.errors } })
}

/* ------------------------------------------------------------------------------------------ */
/* RPC errors                                                                                   */
/* ------------------------------------------------------------------------------------------ */

const INVALID_TOKEN_DETAIL: Readonly<Record<string, string>> = {
  api_key: 'The API key is not valid.',
  revoked: 'The API key has been revoked.',
  expired: 'The API key has expired.',
  creator_inactive:
    'The API key stopped working because its creator is no longer an owner or admin of the organization; create a new key.',
}

/** Query parameters an MQ422 on a list may name in its hint, with their English rule. */
export const PARAMETER_TEXT: Readonly<Record<string, string>> = {
  limit: 'Must be a whole number within the list limits.',
  from: 'Must be a date (YYYY-MM-DD) on or before to.',
  to: 'Must be a date (YYYY-MM-DD) at most 365 days after from.',
  item_code: 'Must be a part code.',
  location_code: 'Must be a location code.',
  updated_since: 'Must be an RFC 3339 date-time with an offset (2026-10-01T00:00:00Z).',
}

/** SQLSTATEs of values PostgreSQL could not take (bad text representation, \u0000, overflow). */
const BAD_VALUE_CODES = new Set(['22P02', '22P05', '22003', '22007', '22008', '22021', '22023'])
const BUSY_CODES = new Set(['55P03', '40P01', '40001'])
/** Gateway, connection-pool and fetch failures: the database was not reached (or not in time). */
const UNAVAILABLE_CODES = new Set([
  'fetch_failed',
  'http_502',
  'http_503',
  'http_504',
  'PGRST000',
  'PGRST001',
  'PGRST002',
  'PGRST003',
])

export type MappedProblem = {
  problem: ApiProblem
  /** Not a caller's mistake or a known condition: the handler logs SQLSTATE and message. */
  unexpected: boolean
}

export type RpcProblemContext = {
  requestId: string
  /** The request method: an MQ422 is a 400 parameter problem on GET and a 422 on POST. */
  method: string
  /** The scope the operation needs (403 names it). */
  requiredScope?: ApiScope | null
}

function parseDetails(details: string | null | undefined): Record<string, unknown> | null {
  if (!details) return null
  try {
    const value: unknown = JSON.parse(details)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function nonNegativeInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

const FIELD_NAME = /^[a-z][a-z0-9_]{0,62}$/

/**
 * The answer to the SQL shape backstop (`app.api_check_fields`: MQ422 hint `records`, detail
 * `{code, record?, field?, limit?}`), which only fires when the Worker's checks missed something:
 * `too_many_records` is a 413, anything else a 422 `invalid_request` with one item. The field
 * is the caller's own member name (clipped to 64 characters by SQL), echoed in the pointer.
 */
function backstopProblem(details: string | null | undefined, requestId: string): ApiProblem {
  const detail = parseDetails(details)
  if (detail?.code === 'too_many_records') {
    const limit = nonNegativeInt(detail.limit)
    return toProblem('too_many_records', requestId, {
      extensions: limit === null ? {} : { limit },
    })
  }
  const record = nonNegativeInt(detail?.record)
  const field =
    typeof detail?.field === 'string' && detail.field !== '' && detail.field.length <= 64
      ? detail.field
      : null
  const code: RequestErrorCode =
    typeof detail?.code === 'string' &&
    (REQUEST_ERROR_CODES as readonly string[]).includes(detail.code)
      ? (detail.code as RequestErrorCode)
      : 'invalid_record'
  // A member of the body itself (`{"records": [...], "extra": 1}`) has no record.
  const pointer =
    code === 'unknown_field' && record === null && field !== null
      ? `#/${pointerToken(field)}`
      : recordPointer(record, field)
  const issue: RequestIssue = { pointer, record, field, code, detail: errorText(code) }
  return toProblem('invalid_request', requestId, {
    extensions: { error_count: 1, errors: [issue], errors_truncated: false },
  })
}

/**
 * The problem for an error of an `api_*` RPC (`{code, message, details, hint}` from PostgREST,
 * or `fetch_failed` / `http_<status>` from `src/lib/supabase/api.ts`). The RPC's message never
 * reaches the caller: details are rebuilt from the code and an identifier-like hint.
 */
export function apiProblemFor(error: RpcErrorLike, context: RpcProblemContext): MappedProblem {
  const { requestId } = context
  const code = error?.code ?? ''
  const hint = identifierHint(error?.hint)
  const isGet = context.method === 'GET' || context.method === 'HEAD'
  const known = (problem: ApiProblem): MappedProblem => ({ problem, unexpected: false })

  switch (code) {
    case 'MQ401':
      return known(
        toProblem('invalid_token', requestId, {
          detail: INVALID_TOKEN_DETAIL[hint ?? 'api_key'] ?? INVALID_TOKEN_DETAIL.api_key,
        }),
      )
    case 'MQ403':
      return known(
        toProblem('insufficient_scope', requestId, { requiredScope: context.requiredScope }),
      )
    case 'MQ404':
      return known(toProblem('not_found', requestId))
    case 'MQ409':
      if (hint === 'import_in_progress') return known(toProblem('import_in_progress', requestId))
      if (hint === 'another_commit') {
        return known(
          toProblem('import_in_progress', requestId, {
            retryAfter: RETRY_AFTER_SECONDS.another_commit,
          }),
        )
      }
      return known(toProblem('busy', requestId))
    case 'MQ422':
      if (isGet) {
        if (hint === 'cursor') return known(toProblem('invalid_cursor', requestId))
        const errors: ParameterIssue[] =
          hint && Object.hasOwn(PARAMETER_TEXT, hint)
            ? [{ parameter: hint, detail: PARAMETER_TEXT[hint] ?? '' }]
            : []
        return known(toProblem('invalid_parameter', requestId, { extensions: { errors } }))
      }
      if (hint === 'records') return known(backstopProblem(error?.details, requestId))
      return known(
        toProblem('invalid_request', requestId, {
          extensions: { error_count: 0, errors: [], errors_truncated: false },
        }),
      )
    case 'MQ429':
      return known(
        toProblem(hint === 'api_writes_per_day' ? 'daily_limit' : 'rate_limited', requestId),
      )
    case '57014':
      return known(toProblem('timeout', requestId))
    default:
      break
  }
  if (BUSY_CODES.has(code)) return known(toProblem('busy', requestId))
  if (BAD_VALUE_CODES.has(code)) {
    return known(
      isGet
        ? toProblem('invalid_parameter', requestId, { extensions: { errors: [] } })
        : toProblem('invalid_json', requestId),
    )
  }
  if (UNAVAILABLE_CODES.has(code)) return known(toProblem('unavailable', requestId))
  // PGRST202 (migration not pushed), PGRST301-303 and 42501 (secret key misconfigured), a leaked
  // MQ499 and anything else.
  return { problem: toProblem('internal_error', requestId), unexpected: true }
}

/* ------------------------------------------------------------------------------------------ */
/* Upsert results                                                                               */
/* ------------------------------------------------------------------------------------------ */

/** An item of `errors[]` / `warnings[]` of an upsert answer. */
export type ResultItem = {
  pointer: string
  record: number | null
  field: string | null
  code: string
  value?: string | null
  detail: string
  /** `duplicate_key`: the first record with the same key (0-based). */
  first_record?: number
  /** Two-column rules: the stored values the record was compared with. */
  stored?: Record<string, string | number | boolean | null>
}

export const COUNT_KEYS = [
  'inserted',
  'updated',
  'unchanged',
  'deleted',
  'skipped',
  'parents_set',
  'preferred_cleared',
] as const

export type UpsertCounts = Partial<Record<(typeof COUNT_KEYS)[number], number>>

/** The 200 body of an upsert. */
export type UpsertSuccess = {
  import_id: string | null
  recorded: boolean
  request_id: string
  resource: string
  records: number
  counts: UpsertCounts
  warning_count: number
  warnings: ResultItem[]
  warnings_truncated: boolean
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clip(value: string): string {
  return value.length > API_LIMITS.valueChars ? value.slice(0, API_LIMITS.valueChars) : value
}

function storedValues(value: unknown): ResultItem['stored'] | undefined {
  if (!isObject(value)) return undefined
  const out: Record<string, string | number | boolean | null> = {}
  for (const [key, item] of Object.entries(value)) {
    if (!FIELD_NAME.test(key)) continue
    if (typeof item === 'string') out[key] = clip(item)
    else if (typeof item === 'number' && Number.isFinite(item)) out[key] = item
    else if (typeof item === 'boolean' || item === null) out[key] = item
  }
  return Object.keys(out).length > 0 ? out : undefined
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * One error or warning of `app.api_error_result` / `app.api_success_result`, rebuilt from an
 * allow-list: pointer, record, field, code, the caller's value (clipped to 200 characters) and,
 * from the database's detail object, only `first_record` and `stored`. The English text comes
 * from `errors.ts`.
 */
export function resultItem(raw: unknown): ResultItem | null {
  if (!isObject(raw)) return null
  const record = nonNegativeInt(raw.record)
  const field = typeof raw.field === 'string' && FIELD_NAME.test(raw.field) ? raw.field : null
  const code =
    typeof raw.code === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(raw.code) ? raw.code : null
  if (code === null) return null
  const pointer =
    typeof raw.pointer === 'string' && POINTER_PATTERN.test(raw.pointer)
      ? raw.pointer
      : recordPointer(record, field)
  const detail = isObject(raw.detail) ? raw.detail : {}
  const firstRecord = nonNegativeInt(detail.first_record)
  const item: ResultItem = { pointer, record, field, code, detail: errorText(code, firstRecord) }
  if ('value' in raw) item.value = typeof raw.value === 'string' ? clip(raw.value) : null
  if (firstRecord !== null) item.first_record = firstRecord
  const stored = storedValues(detail.stored)
  if (stored) item.stored = stored
  return item
}

function resultItems(raw: unknown, max: number): ResultItem[] {
  if (!Array.isArray(raw)) return []
  return raw
    .slice(0, max)
    .map(resultItem)
    .filter((item): item is ResultItem => item !== null)
}

function count(value: unknown): number {
  return nonNegativeInt(value) ?? 0
}

function counts(raw: unknown): UpsertCounts {
  const out: UpsertCounts = {}
  if (!isObject(raw)) return out
  for (const key of COUNT_KEYS) {
    const value = nonNegativeInt(raw[key])
    if (value !== null) out[key] = value
  }
  return out
}

/** `{code: {column: n}}` with identifier codes and columns (`''` for record-level codes). */
function errorCounts(raw: unknown): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}
  if (!isObject(raw)) return out
  for (const [code, columns] of Object.entries(raw)) {
    if (!FIELD_NAME.test(code) || !isObject(columns)) continue
    const perColumn: Record<string, number> = {}
    for (const [column, value] of Object.entries(columns)) {
      if ((column === '' || FIELD_NAME.test(column)) && nonNegativeInt(value) !== null) {
        perColumn[column] = value as number
      }
    }
    out[code] = perColumn
  }
  return out
}

export type UpsertOutcome =
  | { ok: true; status: 200; body: UpsertSuccess }
  | { ok: false; problem: ApiProblem; unexpected: boolean }

/**
 * The answer for the jsonb an `api_upsert` call returned: `succeeded` → 200 with the request id
 * and resource name; `invalid` → 422 `validation_failed`; `conflict` → 409 `write_conflict`;
 * anything else → 500.
 */
export function mapUpsertResult(
  result: unknown,
  context: { requestId: string; resource: string },
): UpsertOutcome {
  const { requestId } = context
  if (!isObject(result)) {
    return { ok: false, problem: toProblem('internal_error', requestId), unexpected: true }
  }
  if (result.result === 'succeeded') {
    const importId =
      typeof result.import_id === 'string' && UUID.test(result.import_id) ? result.import_id : null
    return {
      ok: true,
      status: 200,
      body: {
        import_id: importId,
        recorded: result.recorded === true && importId !== null,
        request_id: requestId,
        resource: context.resource,
        records: count(result.records),
        counts: counts(result.counts),
        warning_count: count(result.warning_count),
        warnings: resultItems(result.warnings, API_LIMITS.warnings),
        warnings_truncated: result.warnings_truncated === true,
      },
    }
  }
  if (result.result === 'invalid' || result.result === 'conflict') {
    const shared = {
      error_count: count(result.error_count),
      error_counts: errorCounts(result.error_counts),
      errors: resultItems(result.errors, API_LIMITS.validationErrors),
      errors_truncated: result.errors_truncated === true,
    }
    if (result.result === 'invalid') {
      return {
        ok: false,
        unexpected: false,
        problem: toProblem('validation_failed', requestId, {
          extensions: {
            ...shared,
            warning_count: count(result.warning_count),
            warnings: resultItems(result.warnings, API_LIMITS.warnings),
            warnings_truncated: result.warnings_truncated === true,
          },
        }),
      }
    }
    const failureCode =
      typeof result.failure_code === 'string' && FIELD_NAME.test(result.failure_code)
        ? result.failure_code
        : 'changed_during_commit'
    return {
      ok: false,
      unexpected: false,
      problem: toProblem('write_conflict', requestId, {
        detail: `${errorText(failureCode)} Nothing was saved.`,
        extensions: { failure_code: failureCode, ...shared },
      }),
    }
  }
  return { ok: false, problem: toProblem('internal_error', requestId), unexpected: true }
}

/* ------------------------------------------------------------------------------------------ */
/* Responses                                                                                    */
/* ------------------------------------------------------------------------------------------ */

export const PROBLEM_CONTENT_TYPE = 'application/problem+json'
export const JSON_CONTENT_TYPE = 'application/json; charset=utf-8'
/** Every `/api/v1` answer except the OpenAPI document. */
export const API_CACHE_CONTROL = 'no-store'

/** `Server-Timing: db;dur=12.3, total;dur=20.1` (milliseconds, one decimal). */
export function serverTiming(timings: { db?: number | null; total: number }): string {
  const parts: string[] = []
  if (typeof timings.db === 'number' && Number.isFinite(timings.db)) {
    parts.push(`db;dur=${Math.max(0, timings.db).toFixed(1)}`)
  }
  parts.push(`total;dur=${Math.max(0, timings.total).toFixed(1)}`)
  return parts.join(', ')
}

function mergeHeaders(base: Record<string, string>, extra?: HeadersInit): Headers {
  const headers = new Headers(extra)
  for (const [name, value] of Object.entries(base)) headers.set(name, value)
  return headers
}

/**
 * A problem as a Response: `application/problem+json`, `Cache-Control: no-store`, the problem's
 * own headers, plus `headers` (X-Request-Id, Server-Timing, deprecation).
 */
export function problemResponse(problem: ApiProblem, headers?: HeadersInit): Response {
  const merged = mergeHeaders(problem.headers, headers)
  merged.set('Content-Type', PROBLEM_CONTENT_TYPE)
  merged.set('Cache-Control', API_CACHE_CONTROL)
  return new Response(JSON.stringify(problem.body), { status: problem.status, headers: merged })
}

/**
 * A JSON answer. A string body is sent as it is (list and organization results pass through
 * from PostgREST without being parsed); anything else is serialized.
 */
export function jsonResponse(status: number, body: unknown, headers?: HeadersInit): Response {
  const merged = new Headers(headers)
  merged.set('Content-Type', JSON_CONTENT_TYPE)
  merged.set('Cache-Control', API_CACHE_CONTROL)
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? null)
  return new Response(text, { status, headers: merged })
}
