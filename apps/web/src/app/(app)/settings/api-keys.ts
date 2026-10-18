import { z } from 'zod'
import type { ApiScope } from '../../../lib/api/auth'
import { isAdminRole, isRole } from '../../../lib/auth/roles'

/**
 * Settings' view of the organization's API keys: what each row shows and how the create form is
 * checked. Pure (relative imports, no server or React code), so Vitest covers it and the Client
 * Components import its types only; the page computes the rows on the server, so the status is
 * decided once against the server's clock.
 */

/** Message keys of the scopes in the ApiKeys namespace (`ApiKeys.scopes.<key>.label`). */
export const SCOPE_MESSAGE_KEYS = {
  'master_data:read': 'masterDataRead',
  'master_data:write': 'masterDataWrite',
  'transactions:read': 'transactionsRead',
  'transactions:write': 'transactionsWrite',
  'purchase_handoffs:read': 'purchaseHandoffsRead',
  'purchase_handoffs:acknowledge': 'purchaseHandoffsAcknowledge',
  'transfer_handoffs:read': 'transferHandoffsRead',
  'transfer_handoffs:acknowledge': 'transferHandoffsAcknowledge',
  'event_purchase_handoffs:read': 'eventPurchaseHandoffsRead',
  'event_purchase_handoffs:acknowledge': 'eventPurchaseHandoffsAcknowledge',
} as const satisfies Record<ApiScope, string>

export type ScopeMessageKey = (typeof SCOPE_MESSAGE_KEYS)[ApiScope]

export type ScopeOption = { value: ApiScope; key: ScopeMessageKey }

/** The scopes in the given order with their message keys; unknown values are dropped. */
export function scopeOptions(scopes: readonly string[]): ScopeOption[] {
  return scopes.flatMap((scope) =>
    Object.hasOwn(SCOPE_MESSAGE_KEYS, scope)
      ? [{ value: scope as ApiScope, key: SCOPE_MESSAGE_KEYS[scope as ApiScope] }]
      : [],
  )
}

/** Under this many days left, an active key shows "expires in N days". */
export const EXPIRY_WARNING_DAYS = 14
const DAY_MS = 86_400_000

export type ApiKeyStatus =
  | { kind: 'active' }
  | { kind: 'expiresSoon'; days: number }
  | { kind: 'expired' }
  | { kind: 'revoked' }
  /** The creator is no longer an owner or admin: the API answers 401 `creator_inactive`. */
  | { kind: 'creatorInactive' }

type KeyTimes = { expires_at: string; revoked_at: string | null }

/**
 * Revoked, then expired, then a creator who lost the owner or admin role (the three ways
 * `app.api_authorize` refuses a key, in its order), then the expiry warning.
 */
export function apiKeyStatus(
  key: KeyTimes & { creatorActive: boolean },
  now: number = Date.now(),
): ApiKeyStatus {
  if (key.revoked_at) return { kind: 'revoked' }
  const expires = Date.parse(key.expires_at)
  if (!Number.isFinite(expires) || expires <= now) return { kind: 'expired' }
  if (!key.creatorActive) return { kind: 'creatorInactive' }
  const left = expires - now
  if (left < EXPIRY_WARNING_DAYS * DAY_MS) {
    return { kind: 'expiresSoon', days: Math.ceil(left / DAY_MS) }
  }
  return { kind: 'active' }
}

/**
 * Whether the key counts towards the organization's active-key limit, as `create_api_key` counts:
 * not revoked and not expired (a key whose creator lost the role still counts until revoked).
 */
export function isActiveApiKey(key: KeyTimes, now: number = Date.now()): boolean {
  if (key.revoked_at) return false
  const expires = Date.parse(key.expires_at)
  return Number.isFinite(expires) && expires > now
}

/**
 * The keys Settings lists: every active key (an organization has at most 20, so none is ever cut
 * off and each can be revoked) plus the newest others, each once, newest first.
 */
export function listedApiKeys<K extends { id: string; created_at: string }>(
  active: readonly K[],
  recent: readonly K[],
): K[] {
  const byId = new Map<string, K>()
  for (const key of [...active, ...recent]) if (!byId.has(key.id)) byId.set(key.id, key)
  return [...byId.values()].sort(
    (a, b) =>
      Date.parse(b.created_at) - Date.parse(a.created_at) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

/** How Settings shows a key; the same text as `displayKey` in src/lib/api/keys.ts. */
export function keyDisplay(displayPrefix: string, last4: string): string {
  return `${displayPrefix}…${last4}`
}

/** The columns Settings reads from api_keys (never `*`: `key_hash` is not granted). */
export const API_KEY_COLUMNS =
  'id, name, display_prefix, last4, scopes, created_by, created_at, expires_at, last_used_at, revoked_at'

export type ApiKeyRecord = {
  id: string
  name: string
  display_prefix: string
  last4: string
  scopes: string[]
  created_by: string | null
  created_at: string
  expires_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export type MemberRecord = { user_id: string; email: string; role: string }

export type ApiKeyRow = {
  id: string
  name: string
  /** `maqdar_sk_AbCd…wxyz`. */
  display: string
  scopes: ScopeOption[]
  created_at: string
  /** The creator's e-mail while they are a member; null for a former member. */
  creator: string | null
  last_used_at: string | null
  expires_at: string
  revoked_at: string | null
  status: ApiKeyStatus
}

/** The rows of the API keys card, in the order given (newest first from the query). */
export function toApiKeyRows(
  keys: readonly ApiKeyRecord[],
  members: readonly MemberRecord[],
  now: number = Date.now(),
): ApiKeyRow[] {
  const byId = new Map(members.map((member) => [member.user_id, member]))
  return keys.map((key) => {
    const member = key.created_by ? byId.get(key.created_by) : undefined
    const creatorActive = member !== undefined && isRole(member.role) && isAdminRole(member.role)
    return {
      id: key.id,
      name: key.name,
      display: keyDisplay(key.display_prefix, key.last4),
      scopes: scopeOptions(key.scopes),
      created_at: key.created_at,
      creator: member?.email ?? null,
      last_used_at: key.last_used_at,
      expires_at: key.expires_at,
      revoked_at: key.revoked_at,
      status: apiKeyStatus({ ...key, creatorActive }, now),
    }
  })
}

/* ------------------------------------------------------------------------------------------ */
/* Create form                                                                                  */
/* ------------------------------------------------------------------------------------------ */

/** Form fields of the create form, as the action reads them. */
export const API_KEY_FIELDS = ['name', 'expires_in_days'] as const
export type ApiKeyField = 'name' | 'scopes' | 'expires_in_days'

/** C0 and C1 controls and DEL (Postgres `[[:cntrl:]]` is a subset). */
const CONTROL = /\p{Cc}/u

/**
 * The create form: a name of 1-80 characters (counted as Postgres counts them, in code points)
 * without control characters, at least one of `scopes` (each once), and one of the offered expiry
 * choices. `create_api_key` checks the same and accepts 1-366 days.
 */
export function apiKeyFormSchema(scopes: readonly ApiScope[], expiryDays: readonly number[]) {
  return z.object({
    name: z
      .string()
      .trim()
      .refine((name) => {
        const length = [...name].length
        return length >= 1 && length <= 80 && !CONTROL.test(name)
      }),
    scopes: z
      .array(z.string())
      .min(1)
      .max(scopes.length)
      .refine((values) => new Set(values).size === values.length)
      .refine((values) => values.every((value) => (scopes as readonly string[]).includes(value)))
      .transform((values) => values as ApiScope[]),
    expires_in_days: z
      .string()
      .regex(/^\d{1,3}$/)
      .transform(Number)
      .refine((days) => expiryDays.includes(days)),
  })
}

/** The fields a failed parse names, for one translated message each. */
export function apiKeyErrorFields(
  issues: readonly { path: readonly PropertyKey[] }[],
): ApiKeyField[] {
  const fields = new Set<ApiKeyField>()
  for (const issue of issues) {
    const field = issue.path[0]
    if (field === 'name' || field === 'scopes' || field === 'expires_in_days') fields.add(field)
  }
  return [...fields]
}

/** Whether an RPC hint names a form field (`create_api_key` raises MQ422 with the parameter). */
export function isApiKeyField(value: unknown): value is ApiKeyField {
  return value === 'name' || value === 'scopes' || value === 'expires_in_days'
}
