import 'server-only'
import { callApiRpc, callApiUpsert } from '@/lib/supabase/api'
import { apiPlatform } from './bindings'
import type { ApiDeps } from './handler'

/**
 * The production dependencies of the `/api/v1` handler: the `api_*` RPCs through
 * `src/lib/supabase/api.ts` (the secret key in `apikey` only) and the Cloudflare bindings of the
 * current request. Route files pass `apiDeps` to the entry points of `handler.ts`.
 */
export const apiDeps: ApiDeps = {
  rpc: callApiRpc,
  upsert: callApiUpsert,
  platform: () => apiPlatform(),
}
