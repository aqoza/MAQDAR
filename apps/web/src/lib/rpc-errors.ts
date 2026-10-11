/**
 * The RPCs raise custom SQLSTATEs (see the tenancy_auth_completion migration) that PostgREST passes
 * through as `error.code`, next to PostgreSQL's own constraint and privilege codes. The keys below
 * exist in the RpcErrors message namespace.
 */
export const RPC_ERROR_KEYS = [
  'MQ401',
  'MQ403',
  'MQ404',
  'MQ409',
  'MQ422',
  'MQ429',
  '23505',
  '23503',
  '23514',
  '23P01',
  '42501',
  'generic',
] as const

export type RpcErrorKey = (typeof RPC_ERROR_KEYS)[number]

export type RpcErrorLike =
  | {
      code?: string | null
      message?: string | null
      details?: string | null
      hint?: string | null
    }
  | null
  | undefined

export function rpcErrorKey(error: RpcErrorLike): RpcErrorKey {
  const code = error?.code ?? ''
  return (RPC_ERROR_KEYS as readonly string[]).includes(code) ? (code as RpcErrorKey) : 'generic'
}

export function isRpcCode(error: RpcErrorLike, code: RpcErrorKey): boolean {
  return (error?.code ?? '') === code
}

/** SQLSTATEs whose message names the violated constraint. */
const CONSTRAINT_CODES = new Set(['23505', '23503', '23514', '23P01', '23502'])

/**
 * The constraint a unique (23505), foreign key (23503), check (23514) or exclusion (23P01)
 * violation names, e.g. `items_organization_id_code_key`, read from the PostgreSQL message that
 * PostgREST passes through (`… violates unique constraint "name"`). Null for other errors.
 */
export function violatedConstraint(error: RpcErrorLike): string | null {
  if (!error?.code || !CONSTRAINT_CODES.has(error.code)) return null
  for (const text of [error.message, error.details]) {
    const match = text ? /constraint "([^"]+)"/.exec(text) : null
    if (match?.[1]) return match[1]
  }
  return null
}

/**
 * The hint of a custom MAQDAR error, which names the offending form field (the graph guards raise
 * MQ422 with hint `successor_item_code` or `parent_location_id`). Only identifier-like hints count.
 */
export function errorHintField(error: RpcErrorLike): string | null {
  const hint = error?.hint?.trim() ?? ''
  return /^[a-z][a-z0-9_]{0,62}$/.test(hint) ? hint : null
}
