import type { EntityName } from '../imports/contract'
import { checkFormat, parseBearer } from './keys'
import { isTransactionEntity } from './limits'
import { toProblem, type ApiProblem } from './problem'

/**
 * Scopes and the Worker's side of authentication. Keys are checked offline first (header, format,
 * checksum: 401 without a database call); `app.api_authorize` checks the hash, revocation, expiry,
 * the creator rule and the scope inside every `api_*` RPC. When the Worker already has a
 * request-shape problem to answer, it first confirms the key with `api_organization` (J8), so an
 * invalid key always gets 401 and a key without the scope 403. Pure module.
 */

export const API_SCOPES = [
  'master_data:read',
  'master_data:write',
  'transactions:read',
  'transactions:write',
  'purchase_handoffs:read',
  'purchase_handoffs:acknowledge',
] as const

export type ApiScope = (typeof API_SCOPES)[number]

/** One line per scope (Settings and the OpenAPI document). A write scope does not imply read. */
export const SCOPE_DESCRIPTIONS: Readonly<Record<ApiScope, string>> = {
  'master_data:read': 'List master data (calendars, locations, brands, items, suppliers, …).',
  'master_data:write': 'Upsert master data.',
  'transactions:read': 'List demand history, stock snapshots, open orders and receipts.',
  'transactions:write': 'Upsert demand history, stock snapshots, open orders and receipts.',
  'purchase_handoffs:read':
    'Read saved purchase handoffs and batches across the organization; no order execution.',
  'purchase_handoffs:acknowledge':
    'Append external receipt or rejection reports for saved purchase handoffs and batches across the organization; no order execution.',
}

export function isApiScope(value: unknown): value is ApiScope {
  return typeof value === 'string' && (API_SCOPES as readonly string[]).includes(value)
}

export type ApiAccess = 'read' | 'write'

/** The scope an operation on the entity needs: `transactions:*` for demand history. */
export function scopeFor(entity: EntityName, access: ApiAccess): ApiScope {
  return `${isTransactionEntity(entity) ? 'transactions' : 'master_data'}:${access}`
}

export type Credential =
  | { ok: true; token: string }
  /** `unauthorized`: no bearer credential at all; `invalid_token`: a bearer that is not a key. */
  | { ok: false; code: 'unauthorized' | 'invalid_token' }

/**
 * The bearer token of a request, checked offline: `Authorization: Bearer <key>` with a well-formed
 * key whose checksum matches. Never reads the query string or cookies.
 */
export function readCredential(headers: Headers): Credential {
  const bearer = parseBearer(headers.get('authorization'))
  if (bearer.kind === 'missing') return { ok: false, code: 'unauthorized' }
  if (bearer.kind === 'malformed' || !checkFormat(bearer.token)) {
    return { ok: false, code: 'invalid_token' }
  }
  return { ok: true, token: bearer.token }
}

/** The 401 for a failed `readCredential`. */
export function credentialProblem(
  code: 'unauthorized' | 'invalid_token',
  requestId: string,
): ApiProblem {
  return code === 'unauthorized'
    ? toProblem('unauthorized', requestId)
    : toProblem('invalid_token', requestId, {
        detail: 'The bearer token is not a well-formed MAQDAR API key.',
      })
}

/** The scopes in an `api_organization` result (`{key: {scopes: [...]}}`), or null if absent. */
export function keyScopes(organization: unknown): ApiScope[] | null {
  if (typeof organization !== 'object' || organization === null) return null
  const key = (organization as { key?: unknown }).key
  if (typeof key !== 'object' || key === null) return null
  const scopes = (key as { scopes?: unknown }).scopes
  if (!Array.isArray(scopes)) return null
  return scopes.filter(isApiScope)
}

/**
 * What to answer when a request-shape problem is pending and `api_organization` confirmed the key
 * (an MQ401 from that call is answered through `apiProblemFor` instead): 403 when the key lacks
 * the operation's scope, else the pending problem. An unreadable result is a 500.
 */
export function resolvePendingProblem(input: {
  /** The text `api_organization` returned. */
  organizationText: string
  /** The scope the operation needs; null for scope-free endpoints. */
  requiredScope: ApiScope | null
  pending: ApiProblem
  requestId: string
}): ApiProblem {
  let organization: unknown
  try {
    organization = JSON.parse(input.organizationText)
  } catch {
    return toProblem('internal_error', input.requestId)
  }
  const scopes = keyScopes(organization)
  if (scopes === null) return toProblem('internal_error', input.requestId)
  if (input.requiredScope !== null && !scopes.includes(input.requiredScope)) {
    return toProblem('insufficient_scope', input.requestId, { requiredScope: input.requiredScope })
  }
  return input.pending
}
