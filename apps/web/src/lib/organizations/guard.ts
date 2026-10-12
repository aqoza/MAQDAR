import 'server-only'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { isEditorRole } from '@/lib/auth/roles'
import { requireClaims } from '@/lib/auth/session'
import type { ActionState } from '@/lib/forms'
import { getActiveContext, type ActiveContext } from '@/lib/organizations/context'
import { rpcErrorKey, type RpcErrorLike } from '@/lib/rpc-errors'

export type ActiveOrganization =
  { ok: true; context: ActiveContext; organizationId: string } | { ok: false; state: ActionState }

/**
 * For Server Actions that act on the active organization. The organization comes from the session
 * (the token's active organization, checked against the database), never from the form. The form's
 * hidden `organization_id` (ActiveOrganizationField) only detects a stale page: if the user switched
 * organizations in another tab or window, the action refuses instead of acting on another one.
 */
export async function requireActiveOrganization(formData: FormData): Promise<ActiveOrganization> {
  await requireClaims()
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  if (formData.get('organization_id') !== context.active.id) {
    const t = await getTranslations('Common')
    return {
      ok: false,
      state: { status: 'error', message: t('staleOrganization'), code: 'stale_organization' },
    }
  }
  return { ok: true, context, organizationId: context.active.id }
}

/** requireActiveOrganization plus an editor role (owner, admin, planner). RLS stays the authority. */
export async function requireEditor(formData: FormData): Promise<ActiveOrganization> {
  const guard = await requireActiveOrganization(formData)
  if (!guard.ok) return guard
  if (!isEditorRole(guard.context.role)) {
    return { ok: false, state: await rpcErrorState({ code: 'MQ403' }) }
  }
  return guard
}

/** Translated ActionState for a PostgREST / RPC error (SQLSTATE in error.code). */
export async function rpcErrorState(error: RpcErrorLike): Promise<ActionState> {
  const t = await getTranslations('RpcErrors')
  const key = rpcErrorKey(error)
  return { status: 'error', message: t(key), code: error?.code ?? key }
}

/** Generic validation failure for inputs that are not user-editable (hidden ids and the like). */
export async function invalidState(code: string): Promise<ActionState> {
  const t = await getTranslations('Validation')
  return { status: 'error', message: t('generic'), code }
}
