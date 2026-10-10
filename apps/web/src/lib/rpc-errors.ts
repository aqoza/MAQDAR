/**
 * The RPCs raise custom SQLSTATEs (see the tenancy_auth_completion migration) that PostgREST passes
 * through as `error.code`. The keys below exist in the RpcErrors message namespace.
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
  'generic',
] as const

export type RpcErrorKey = (typeof RPC_ERROR_KEYS)[number]

export type RpcErrorLike = { code?: string | null; message?: string | null } | null | undefined

export function rpcErrorKey(error: RpcErrorLike): RpcErrorKey {
  const code = error?.code ?? ''
  return (RPC_ERROR_KEYS as readonly string[]).includes(code) ? (code as RpcErrorKey) : 'generic'
}

export function isRpcCode(error: RpcErrorLike, code: RpcErrorKey): boolean {
  return (error?.code ?? '') === code
}
