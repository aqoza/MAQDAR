import { getColumn, type EntityName } from '../imports/contract'
import type { KeyHash } from './keys'
import { API_LIMITS, listLimits } from './limits'
import type { ApiRpcArgs } from './rpc-request'

/**
 * Query parameters of the list endpoints, checked in the Worker before any database call (400
 * `invalid_parameter` / `invalid_cursor`); `api_list` and `api_list_demand` check them again.
 *
 * - Master data: `limit` (1-1,000, default 100), `cursor`, `updated_since` (RFC 3339 with an
 *   offset).
 * - `demand-history`: `from` and `to` (required, inclusive, at most 366 days), `item_code`,
 *   `location_code`, `limit` (1-5,000, default 1,000), `cursor`.
 *
 * Unknown, repeated and empty parameters are refused; out-of-range limits are refused, never
 * clamped. Cursors are opaque base64url built and type-checked in SQL; the Worker only checks
 * their length and alphabet. Pure module.
 */

export type MasterListQuery = {
  kind: 'master'
  entity: EntityName
  limit: number
  cursor: string | null
  /** The parameter as sent (validated); PostgREST hands it to a timestamptz. */
  updatedSince: string | null
}

export type DemandListQuery = {
  kind: 'demand'
  entity: EntityName
  /** YYYY-MM-DD, inclusive. */
  from: string
  to: string
  itemCode: string | null
  locationCode: string | null
  limit: number
  cursor: string | null
}

export type ListQuery = MasterListQuery | DemandListQuery

export type ParameterIssue = { parameter: string; detail: string }

export type ListQueryFailure = {
  ok: false
  /** `invalid_cursor` when the cursor is the only problem. */
  code: 'invalid_parameter' | 'invalid_cursor'
  errors: ParameterIssue[]
}

export type ListQueryResult = { ok: true; query: ListQuery } | ListQueryFailure

export const MASTER_PARAMETERS = ['limit', 'cursor', 'updated_since'] as const
export const DEMAND_PARAMETERS = [
  'from',
  'to',
  'item_code',
  'location_code',
  'limit',
  'cursor',
] as const

/** The query parameters a list of the entity accepts. */
export function listParameters(entity: EntityName): readonly string[] {
  return entity === 'demand_history' ? DEMAND_PARAMETERS : MASTER_PARAMETERS
}

const CURSOR = /^[A-Za-z0-9_-]+$/
const LIMIT = /^(0|[1-9][0-9]{0,8})$/
const DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/
/** RFC 3339 `date-time`: an offset is required (`Z` or `±hh:mm`). */
const DATE_TIME =
  /^([0-9]{4})-([0-9]{2})-([0-9]{2})[Tt]([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]{1,9})?([Zz]|([+-])([0-9]{2}):([0-9]{2}))$/

const DAY_MS = 86_400_000

/** Milliseconds since the epoch of a valid calendar date (YYYY-MM-DD, years 0001-9999), or null. */
export function parseDate(value: string): number | null {
  const match = DATE.exec(value)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (year < 1 || month < 1 || month > 12 || day < 1) return null
  // setUTCFullYear, unlike Date.UTC, does not map years 0-99 to 1900-1999.
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return date.getTime()
}

/** Whether a value is an RFC 3339 date-time with an offset and valid field ranges. */
export function isRfc3339DateTime(value: string): boolean {
  const match = DATE_TIME.exec(value)
  if (!match) return false
  if (parseDate(`${match[1]}-${match[2]}-${match[3]}`) === null) return false
  const [hour, minute, second] = [Number(match[4]), Number(match[5]), Number(match[6])]
  if (hour > 23 || minute > 59 || second > 59) return false
  if (match[9] !== undefined) {
    const [offsetHour, offsetMinute] = [Number(match[10]), Number(match[11])]
    if (offsetHour > 23 || offsetMinute > 59) return false
  }
  return true
}

/** Whether a cursor has the length and alphabet SQL can produce (base64url, no padding). */
export function isWellFormedCursor(value: string): boolean {
  return value.length >= 1 && value.length <= API_LIMITS.cursorChars && CURSOR.test(value)
}

function codePattern(entity: EntityName, column: string): RegExp {
  const pattern = getColumn(entity, column)?.pattern
  if (!pattern) throw new Error(`No pattern for ${entity}.${column}`)
  return new RegExp(pattern)
}

/**
 * Parses and checks the query string of a list. `params` is the request URL's searchParams; a
 * parameter name is matched exactly (`Limit` is unknown).
 */
export function parseListQuery(entity: EntityName, params: URLSearchParams): ListQueryResult {
  const allowed = listParameters(entity)
  const errors: ParameterIssue[] = []
  const values = new Map<string, string>()
  const seen = new Set<string>()

  for (const [name, value] of params) {
    if (!allowed.includes(name)) {
      if (!seen.has(name)) {
        errors.push({
          parameter: name.slice(0, 64),
          detail: `Unknown parameter; this list takes ${allowed.join(', ')}.`,
        })
      }
      seen.add(name)
      continue
    }
    if (seen.has(name)) {
      if (values.has(name)) {
        errors.push({ parameter: name, detail: 'Given more than once.' })
        values.delete(name)
      }
      continue
    }
    seen.add(name)
    if (value === '') errors.push({ parameter: name, detail: 'Must not be empty.' })
    else values.set(name, value)
  }

  const limits = listLimits(entity)
  let limit: number = limits.default
  const rawLimit = values.get('limit')
  if (rawLimit !== undefined) {
    const parsed = LIMIT.test(rawLimit) ? Number(rawLimit) : Number.NaN
    if (Number.isInteger(parsed) && parsed >= limits.min && parsed <= limits.max) limit = parsed
    else {
      errors.push({
        parameter: 'limit',
        detail: `Must be a whole number from ${limits.min} to ${limits.max}.`,
      })
    }
  }

  let cursorError = false
  const cursor = values.get('cursor') ?? null
  if (cursor !== null && !isWellFormedCursor(cursor)) {
    cursorError = true
    errors.push({
      parameter: 'cursor',
      detail: 'Not a cursor of this API; pass next_cursor from the previous page unchanged.',
    })
  }

  let query: ListQuery
  if (!(entity === 'demand_history')) {
    const updatedSince = values.get('updated_since') ?? null
    if (updatedSince !== null && !isRfc3339DateTime(updatedSince)) {
      errors.push({
        parameter: 'updated_since',
        detail: 'Must be an RFC 3339 date-time with an offset (2026-10-01T00:00:00Z).',
      })
    }
    query = { kind: 'master', entity, limit, cursor, updatedSince }
  } else {
    const from = values.get('from')
    const to = values.get('to')
    const fromTime = from === undefined ? null : parseDate(from)
    const toTime = to === undefined ? null : parseDate(to)
    for (const [name, value, time] of [
      ['from', from, fromTime],
      ['to', to, toTime],
    ] as const) {
      if (value === undefined) {
        if (!seen.has(name)) errors.push({ parameter: name, detail: 'Required (YYYY-MM-DD).' })
      } else if (time === null) {
        errors.push({ parameter: name, detail: 'Must be a date (YYYY-MM-DD).' })
      }
    }
    if (fromTime !== null && toTime !== null) {
      if (toTime < fromTime) {
        errors.push({ parameter: 'to', detail: 'Must not be before from.' })
      } else if ((toTime - fromTime) / DAY_MS > API_LIMITS.demandRangeDays - 1) {
        errors.push({
          parameter: 'to',
          detail: `The range may span at most ${API_LIMITS.demandRangeDays} days (from and to included).`,
        })
      }
    }
    const itemCode = values.get('item_code') ?? null
    if (itemCode !== null && !codePattern(entity, 'item_code').test(itemCode)) {
      errors.push({ parameter: 'item_code', detail: 'Must be a part code.' })
    }
    const locationCode = values.get('location_code') ?? null
    if (locationCode !== null && !codePattern(entity, 'location_code').test(locationCode)) {
      errors.push({ parameter: 'location_code', detail: 'Must be a location code.' })
    }
    query = {
      kind: 'demand',
      entity,
      from: from ?? '',
      to: to ?? '',
      itemCode,
      locationCode,
      limit,
      cursor,
    }
  }

  if (errors.length > 0) {
    const onlyCursor = cursorError && errors.length === 1
    return { ok: false, code: onlyCursor ? 'invalid_cursor' : 'invalid_parameter', errors }
  }
  return { ok: true, query }
}

export type ListRpcCall =
  | { name: 'api_list'; args: ApiRpcArgs['api_list'] }
  | { name: 'api_list_demand'; args: ApiRpcArgs['api_list_demand'] }

/** The RPC and its arguments for a checked list query. */
export function listRpcCall(query: ListQuery, keyHash: KeyHash): ListRpcCall {
  if (query.kind === 'master') {
    return {
      name: 'api_list',
      args: {
        p_key_hash: keyHash,
        p_entity: query.entity,
        p_limit: query.limit,
        p_after: query.cursor,
        p_updated_since: query.updatedSince,
      },
    }
  }
  return {
    name: 'api_list_demand',
    args: {
      p_key_hash: keyHash,
      p_from: query.from,
      p_to: query.to,
      p_item_code: query.itemCode,
      p_location_code: query.locationCode,
      p_limit: query.limit,
      p_after: query.cursor,
    },
  }
}
