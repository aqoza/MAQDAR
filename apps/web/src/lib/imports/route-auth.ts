import 'server-only'
import { isEditorRole } from '@/lib/auth/roles'
import { getSessionClaims } from '@/lib/auth/session'
import type { ZeeSpareClaims } from '@/lib/auth/claims'
import { env } from '@/lib/env'
import { getActiveContext, type ActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import type { RpcErrorLike } from '../rpc-errors'
import { errorResponse } from './route'

/** The user's server client (cookie session, RLS applies). */
export type ServerClient = Awaited<ReturnType<typeof createClient>>

export type SessionRoute =
  { ok: true; claims: ZeeSpareClaims; supabase: ServerClient } | { ok: false; response: Response }

export type EditorRoute =
  | { ok: true; context: ActiveContext; organizationId: string; supabase: ServerClient }
  | { ok: false; response: Response }

const signedOut = () => errorResponse(401, { code: 'MQ401' })

/**
 * A verified session and the user's server client, or a 401. For the RPC routes: the RPCs
 * re-check the membership, the role and the organization themselves (MQ403/MQ404), so no extra
 * round trip is spent here. Never the admin client.
 */
export async function requireSessionRoute(): Promise<SessionRoute> {
  const claims = await getSessionClaims()
  if (!claims) return { ok: false, response: signedOut() }
  return { ok: true, claims, supabase: await createClient() }
}

export type RawRpcResult =
  { kind: 'ok'; body: string } | { kind: 'error'; error: RpcErrorLike } | { kind: 'signed_out' }

/**
 * Calls an RPC with a body that is already JSON text, as the user (their access token; PostgREST
 * checks it and RLS applies, exactly as supabase-js would), and returns the result as text. For
 * the chunk route: a megabyte of rows is passed through instead of being parsed and serialized
 * again on the Worker.
 */
export async function callRpcRaw(
  supabase: ServerClient,
  fn: string,
  body: string,
): Promise<RawRpcResult> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return { kind: 'signed_out' }
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body,
    cache: 'no-store',
  })
  const text = await response.text()
  if (response.ok) return { kind: 'ok', body: text }
  let error: RpcErrorLike = { code: `http_${response.status}`, message: response.statusText }
  try {
    const parsed = JSON.parse(text) as Partial<
      Record<'code' | 'message' | 'hint' | 'details', unknown>
    >
    error = {
      code: typeof parsed.code === 'string' ? parsed.code : error.code,
      message: typeof parsed.message === 'string' ? parsed.message : error.message,
      hint: typeof parsed.hint === 'string' ? parsed.hint : null,
      details: typeof parsed.details === 'string' ? parsed.details : null,
    }
  } catch {
    // Not JSON (a proxy error page): the HTTP status stands in for the code.
  }
  return { kind: 'error', error }
}

/**
 * For the read routes (status, original, error report): a session (401), an active organization
 * that the user still belongs to (404 `organization_id`, the stale-tab answer of the RPCs) and an
 * editor role (403 `role`). Import batches, files, errors and originals are readable by editors
 * only; RLS enforces it again, and every query also filters on the active organization.
 */
export async function requireEditorRoute(): Promise<EditorRoute> {
  const claims = await getSessionClaims()
  if (!claims) return { ok: false, response: signedOut() }
  const context = await getActiveContext()
  if (!context?.active) {
    return { ok: false, response: errorResponse(404, { code: 'MQ404', hint: 'organization_id' }) }
  }
  if (!isEditorRole(context.role)) {
    return { ok: false, response: errorResponse(403, { code: 'MQ403', hint: 'role' }) }
  }
  return {
    ok: true,
    context,
    organizationId: context.active.id,
    supabase: await createClient(),
  }
}
