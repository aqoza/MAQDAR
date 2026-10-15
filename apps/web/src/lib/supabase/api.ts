import 'server-only'
import { env } from '@/lib/env'
import { serverEnv } from '@/lib/env.server'
import type { EntityName } from '@/lib/imports/contract'
import type { KeyHash } from '@/lib/api/keys'
import {
  buildRpcRequest,
  executeRpc,
  rpcPayload,
  upsertPayload,
  type ApiRpcArgs,
  type ApiRpcName,
  type ApiRpcResult,
} from '@/lib/api/rpc-request'

/**
 * The only module that sends the Supabase secret key for data: the `/api/v1` route handlers call
 * the `api_*` RPCs through it (a raw fetch to `/rest/v1/rpc/<api_*>` with the key in `apikey`
 * only, never cached). Every `api_*` function authorizes the API key hash itself and filters the
 * organization the key belongs to. ESLint and `src/lib/api/isolation.test.ts` confine imports of
 * this module to `src/lib/api/**` and `src/app/api/v1/**`; `admin.ts` keeps `auth.admin`.
 */

function config() {
  return {
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    secretKey: serverEnv().SUPABASE_SECRET_KEY,
  }
}

/** Calls an `api_*` RPC with plain arguments; the result text is passed through untouched. */
export function callApiRpc<N extends ApiRpcName>(
  name: N,
  args: ApiRpcArgs[N],
): Promise<ApiRpcResult> {
  return executeRpc(buildRpcRequest(name, rpcPayload<N>(args), config()), fetch)
}

/**
 * Calls `api_upsert` with the request's own body text spliced in as `p_body` (only text that
 * `JSON.parse` accepted as one object), so jsonb keeps every digit the caller sent.
 */
export function callApiUpsert(input: {
  keyHash: KeyHash
  entity: EntityName
  bodyText: string
  requestId: string
}): Promise<ApiRpcResult> {
  return executeRpc(buildRpcRequest('api_upsert', upsertPayload(input), config()), fetch)
}
