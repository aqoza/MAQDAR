import { keyHashPrefix, type KeyHash } from './keys'

/**
 * One structured log line per `/api/v1` request (Workers Logs index the object's fields): ids,
 * codes, counts and timings, and the first 8 hex digits of the key's hash. Never the
 * Authorization header, the key, the body or any value; 5xx answers add only the SQLSTATE.
 * Database and fetch messages can contain submitted values or credentials, even when clipped.
 * Every field is rebuilt from an allow-list, so whatever the
 * handler passes, nothing else reaches the log. Pure module.
 */

export type ApiLogInput = {
  requestId: string
  /** `cf-ray` request header (absent under next dev / next start). */
  cfRay?: string | null
  method: string
  /** `organization`, `list:items`, `upsert:demand_history`, `index`, `not_found`, … */
  operation: string
  status: number
  /** The problem code, or null for a success. */
  code?: string | null
  keyHash?: KeyHash | null
  /** Records of an upsert or rows of a page. */
  records?: number | null
  dbMs?: number | null
  totalMs: number
  /** 5xx only: the SQLSTATE or PostgREST code of the failure. */
  sqlstate?: string | null
}

export type ApiLogEntry = {
  msg: 'api'
  request_id: string
  cf_ray: string | null
  method: string
  operation: string
  status: number
  code: string | null
  key: string | null
  records: number | null
  db_ms: number | null
  total_ms: number
  sqlstate?: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CF_RAY = /^[0-9a-f]{16}(-[A-Z]{3})?$/
const METHOD = /^[A-Z]{1,10}$/
const OPERATION = /^[a-z_]{1,32}(:[a-z_]{1,64})?$/
const CODE = /^[a-z][a-z0-9_]{0,62}$/
const SQLSTATE = /^([0-9A-Z]{5}|PGRST[0-9]{3}|fetch_failed|http_[0-9]{3})$/
const KEY_HASH = /^\\x[0-9a-f]{64}$/

function ms(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.max(0, value) * 10) / 10
    : null
}

function count(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/** The log entry for a request, keeping only allow-listed, well-formed fields. */
export function apiLogEntry(input: ApiLogInput): ApiLogEntry {
  const keyHash = input.keyHash
  const entry: ApiLogEntry = {
    msg: 'api',
    request_id: UUID.test(input.requestId) ? input.requestId : 'invalid',
    cf_ray: input.cfRay && CF_RAY.test(input.cfRay) ? input.cfRay : null,
    method: METHOD.test(input.method) ? input.method : 'OTHER',
    operation: OPERATION.test(input.operation) ? input.operation : 'other',
    status: Number.isInteger(input.status) ? input.status : 0,
    code: input.code && CODE.test(input.code) ? input.code : null,
    key: keyHash && KEY_HASH.test(keyHash) ? keyHashPrefix(keyHash, 8) : null,
    records: count(input.records),
    db_ms: ms(input.dbMs),
    total_ms: ms(input.totalMs) ?? 0,
  }
  if (entry.status >= 500) {
    if (input.sqlstate && SQLSTATE.test(input.sqlstate)) entry.sqlstate = input.sqlstate
  }
  return entry
}

export type ApiLogger = Pick<Console, 'log' | 'error'>

/** Writes the request's log line: `console.error` for 5xx answers, `console.log` otherwise. */
export function logApiRequest(input: ApiLogInput, logger: ApiLogger = console): ApiLogEntry {
  const entry = apiLogEntry(input)
  if (entry.status >= 500) logger.error(entry)
  else logger.log(entry)
  return entry
}
