/**
 * The RPCs raise custom SQLSTATEs (see the tenancy_auth_completion migration) that PostgREST passes
 * through as `error.code`, next to PostgreSQL's own constraint and privilege codes. The keys below
 * exist in the RpcErrors message namespace. `busy` (a lock timeout, deadlock or serialization
 * failure: try again) and `timeout` (a statement timeout) each stand for several SQLSTATEs; the
 * import routes also answer with them as their error `code`. `importInProgress` is MQ409 with
 * hint `import_in_progress`: another import holds the organization's import lock.
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
  'busy',
  'timeout',
  'importInProgress',
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

/** SQLSTATEs that share one message: retry soon (`busy`) or with less work (`timeout`). */
const SQLSTATE_KEYS: Readonly<Record<string, RpcErrorKey>> = {
  '55P03': 'busy',
  '40P01': 'busy',
  '40001': 'busy',
  '57014': 'timeout',
}

export function rpcErrorKey(error: RpcErrorLike): RpcErrorKey {
  const code = error?.code ?? ''
  if (Object.hasOwn(SQLSTATE_KEYS, code)) return SQLSTATE_KEYS[code] ?? 'generic'
  if (code === 'MQ409' && error?.hint?.trim() === 'import_in_progress') return 'importInProgress'
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
 * The hint of a custom ZeeSpare error, which names the offending form field (the graph guards raise
 * MQ422 with hint `successor_item_code` or `parent_location_id`). Only identifier-like hints count.
 */
export function errorHintField(error: RpcErrorLike): string | null {
  const hint = error?.hint?.trim() ?? ''
  return /^[a-z][a-z0-9_]{0,62}$/.test(hint) ? hint : null
}
