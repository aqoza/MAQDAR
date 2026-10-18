import type { Database } from '@maqdar/shared/database.types'
import type { EntityName } from '../imports/contract'
import type { RpcErrorLike } from '../rpc-errors'
import type { KeyHash } from './keys'
import type { HandoffResource, TransferHandoffResource, EventHandoffResource } from './handoffs'
import type { AcknowledgementInput } from './acknowledgements'

/**
 * The HTTP requests `src/lib/supabase/api.ts` sends to PostgREST for the `api_*` RPCs, built
 * here so Vitest can assert them (J9). The secret key goes in the `apikey` header only, never in
 * `Authorization`: new-format `sb_secret_` keys must not be sent as a Bearer token. Requests are
 * never cached. Pure module: it takes the URL and the key as arguments and reads no environment.
 */

/** The `api_*` RPCs of the `rest_api` migration and the arguments the Worker sends them. */
export type ApiRpcArgs = {
  api_event_purchase_handoff_acknowledge: {
    p_key_hash: KeyHash
    p_resource: EventHandoffResource
    p_id: string
    p_body: AcknowledgementInput
  }
  api_event_purchase_handoff_acknowledgements: {
    p_key_hash: KeyHash
    p_resource: EventHandoffResource
    p_id: string
    p_event_id: string | null
    p_after: string | null
    p_limit: number
  }
  api_event_purchase_handoff_list: {
    p_key_hash: KeyHash
    p_resource: EventHandoffResource
    p_after: string | null
    p_limit: number
    p_created_since: string | null
  }
  api_event_purchase_handoff_get: {
    p_key_hash: KeyHash
    p_resource: EventHandoffResource
    p_id: string
  }
  api_transfer_handoff_list: {
    p_key_hash: KeyHash
    p_resource: TransferHandoffResource
    p_after: string | null
    p_limit: number
    p_created_since: string | null
  }
  api_transfer_handoff_get: {
    p_key_hash: KeyHash
    p_resource: TransferHandoffResource
    p_id: string
  }
  api_transfer_handoff_acknowledge: {
    p_key_hash: KeyHash
    p_resource: TransferHandoffResource
    p_id: string
    p_body: AcknowledgementInput
  }
  api_transfer_handoff_acknowledgements: {
    p_key_hash: KeyHash
    p_resource: TransferHandoffResource
    p_id: string
    p_event_id: string | null
    p_after: string | null
    p_limit: number
  }
  api_handoff_acknowledge: {
    p_key_hash: KeyHash
    p_resource: HandoffResource
    p_id: string
    p_body: AcknowledgementInput
  }
  api_handoff_acknowledgements: {
    p_key_hash: KeyHash
    p_resource: HandoffResource
    p_id: string
    p_event_id: string | null
    p_after: string | null
    p_limit: number
  }
  api_handoff_list: {
    p_key_hash: KeyHash
    p_resource: HandoffResource
    p_after: string | null
    p_limit: number
    p_created_since: string | null
  }
  api_handoff_get: { p_key_hash: KeyHash; p_resource: HandoffResource; p_id: string }
  api_organization: { p_key_hash: KeyHash }
  api_list: {
    p_key_hash: KeyHash
    p_entity: EntityName
    p_limit: number
    /** The cursor (next_cursor of the previous page). */
    p_after: string | null
    /** RFC 3339 with an offset. */
    p_updated_since: string | null
  }
  api_list_demand: {
    p_key_hash: KeyHash
    /** YYYY-MM-DD, inclusive. */
    p_from: string
    p_to: string
    p_item_code: string | null
    p_location_code: string | null
    p_limit: number
    /** The cursor (next_cursor of the previous page). */
    p_after: string | null
  }
  api_upsert: {
    p_key_hash: KeyHash
    p_entity: EntityName
    /** `{"records": [...]}`; sent as the request's own text, never re-serialized. */
    p_body: unknown
    p_request_id: string
  }
}

type DeclaredApiRpcName = keyof ApiRpcArgs

/** `api_*` functions in the generated types (none until `pnpm db:types` ran after the migration). */
type GeneratedApiRpcName = Extract<keyof Database['public']['Functions'], `api_${string}`>

/**
 * The RPC names `api.ts` may call: `api_*` only. Until the generated types carry the `api_*`
 * functions this is the declared list; afterwards only declared names the database also has.
 */
export type ApiRpcName = [GeneratedApiRpcName] extends [never]
  ? DeclaredApiRpcName
  : Extract<DeclaredApiRpcName, GeneratedApiRpcName>

type Functions = Database['public']['Functions']

/**
 * Declared arguments the generated function types do not have, as `rpc:argument` (never while
 * they match, and never before the generated types carry the `api_*` functions).
 * `rpc-request.test.ts` asserts it is never, so `pnpm typecheck` catches a renamed parameter.
 */
export type UndeclaredRpcArgs = {
  [N in DeclaredApiRpcName]: N extends keyof Functions
    ? `${N}:${Exclude<keyof ApiRpcArgs[N], keyof Functions[N]['Args']> & string}`
    : never
}[DeclaredApiRpcName]

/** Declared RPCs the generated types lack once they carry any `api_*` function. */
export type MissingApiRpcs = [GeneratedApiRpcName] extends [never]
  ? never
  : Exclude<DeclaredApiRpcName, GeneratedApiRpcName>

export const API_RPC_NAMES = [
  'api_event_purchase_handoff_acknowledge',
  'api_event_purchase_handoff_acknowledgements',
  'api_event_purchase_handoff_list',
  'api_event_purchase_handoff_get',
  'api_transfer_handoff_acknowledge',
  'api_transfer_handoff_acknowledgements',
  'api_handoff_acknowledge',
  'api_handoff_acknowledgements',
  'api_handoff_list',
  'api_handoff_get',
  'api_transfer_handoff_list',
  'api_transfer_handoff_get',
  'api_organization',
  'api_list',
  'api_list_demand',
  'api_upsert',
] as const satisfies readonly DeclaredApiRpcName[]

export function isApiRpcName(value: unknown): value is ApiRpcName {
  return typeof value === 'string' && (API_RPC_NAMES as readonly string[]).includes(value)
}

export type RpcConfig = {
  /** NEXT_PUBLIC_SUPABASE_URL. */
  supabaseUrl: string
  /** SUPABASE_SECRET_KEY. */
  secretKey: string
}

export type RpcRequest = {
  url: string
  init: {
    method: 'POST'
    headers: Record<string, string>
    body: string
    cache: 'no-store'
    /** A redirect is never followed: it would carry the apikey header to another origin. */
    redirect: 'manual'
  }
}

/** POST /rest/v1/rpc/<name> with `apikey` only, a JSON body and no caching. */
export function buildRpcRequest(name: ApiRpcName, bodyText: string, config: RpcConfig): RpcRequest {
  if (!isApiRpcName(name)) throw new Error(`Not an api_* RPC: ${String(name)}`)
  const base = config.supabaseUrl.replace(/\/+$/, '')
  return {
    url: `${base}/rest/v1/rpc/${name}`,
    init: {
      method: 'POST',
      headers: {
        apikey: config.secretKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: bodyText,
      cache: 'no-store',
      redirect: 'manual',
    },
  }
}

/** The JSON body of an RPC whose arguments are plain values. */
export function rpcPayload<N extends DeclaredApiRpcName>(args: ApiRpcArgs[N]): string {
  return JSON.stringify(args)
}

/**
 * The `api_upsert` body around the request's own text: `{"p_key_hash":…,"p_entity":…,
 * "p_body":<body text>,"p_request_id":…}`. The body is spliced, not re-serialized, so jsonb keeps
 * every digit the caller sent. Only call it with text `JSON.parse` accepted as one object.
 */
export function upsertPayload(input: {
  keyHash: KeyHash
  entity: EntityName
  bodyText: string
  requestId: string
}): string {
  return `{"p_key_hash":${JSON.stringify(input.keyHash)},"p_entity":${JSON.stringify(input.entity)},"p_body":${input.bodyText},"p_request_id":${JSON.stringify(input.requestId)}}`
}

/* ------------------------------------------------------------------------------------------ */
/* Responses                                                                                    */
/* ------------------------------------------------------------------------------------------ */

export type ApiRpcResult =
  /** The function's JSON result as text (passed through for lists and the organization). */
  | { ok: true; status: number; text: string; ms: number }
  /**
   * PostgREST's `{code, message, details, hint}`; `fetch_failed` when the request did not complete,
   * `http_<status>` when the answer was not a PostgREST error (gateway errors).
   */
  | { ok: false; status: number; error: NonNullable<RpcErrorLike>; ms: number }

function errorFromBody(status: number, text: string): NonNullable<RpcErrorLike> {
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const record = value as Record<string, unknown>
      const str = (key: string) =>
        typeof record[key] === 'string' ? (record[key] as string) : null
      const code = str('code')
      if (code) {
        return { code, message: str('message'), details: str('details'), hint: str('hint') }
      }
    }
  } catch {
    // Not JSON: a gateway or proxy page.
  }
  return { code: `http_${status}`, message: null, details: null, hint: null }
}

export type FetchLike = (url: string, init: RpcRequest['init']) => Promise<Response>

/** Sends a built request and reads the answer. Never throws. */
export async function executeRpc(
  request: RpcRequest,
  fetchImpl: FetchLike,
  now: () => number = () => performance.now(),
): Promise<ApiRpcResult> {
  const started = now()
  try {
    const response = await fetchImpl(request.url, request.init)
    const text = await response.text()
    const ms = now() - started
    if (response.ok) return { ok: true, status: response.status, text, ms }
    return { ok: false, status: response.status, error: errorFromBody(response.status, text), ms }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: {
        code: 'fetch_failed',
        message: error instanceof Error ? error.message : String(error),
        details: null,
        hint: null,
      },
      ms: now() - started,
    }
  }
}
