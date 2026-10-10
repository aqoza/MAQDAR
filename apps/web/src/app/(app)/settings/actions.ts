'use server'

import { createClient as createSupabaseClient, type AuthError } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { siteOrigin } from '@/lib/auth/origin'
import { requireClaims } from '@/lib/auth/session'
import { env } from '@/lib/env'
import { checkboxValue, fieldValues, type ActionState } from '@/lib/forms'
import { getActiveContext, type ActiveContext } from '@/lib/organizations/context'
import {
  emailSchema,
  inviteSchema,
  organizationSettingsSchema,
  roleSchema,
} from '@/lib/organizations/schemas'
import { isRpcCode, rpcErrorKey, type RpcErrorLike } from '@/lib/rpc-errors'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { fieldErrorsFrom } from '@/lib/validation'

/*
 * Every action re-checks the session, reads the organization from the active context (never from
 * the form) and lets the database enforce the rules; what comes back is translated for the form.
 */

const uuidSchema = z.uuid()
const locationIdsSchema = z.array(uuidSchema).max(1000)
const passwordSchema = z.string().min(8).max(72)

type ActiveOrganization =
  { ok: true; context: ActiveContext; organizationId: string } | { ok: false; state: ActionState }

/**
 * The organization comes from the session (the token's active organization), never from the form.
 * The form's hidden `organization_id` only detects a stale page: if the user switched organizations
 * in another tab or window, the action refuses instead of acting on a different organization.
 */
async function requireActiveOrganization(formData: FormData): Promise<ActiveOrganization> {
  await requireClaims()
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  if (formData.get('organization_id') !== context.active.id) {
    const t = await getTranslations('Settings')
    return {
      ok: false,
      state: { status: 'error', message: t('staleOrganization'), code: 'stale_organization' },
    }
  }
  return { ok: true, context, organizationId: context.active.id }
}

async function rpcErrorState(error: RpcErrorLike): Promise<ActionState> {
  const t = await getTranslations('RpcErrors')
  const key = rpcErrorKey(error)
  return { status: 'error', message: t(key), code: error?.code ?? key }
}

async function invalidState(code: string): Promise<ActionState> {
  const t = await getTranslations('Validation')
  return { status: 'error', message: t('generic'), code }
}

/* ------------------------------------------------------------------------------------------ */
/* Organization                                                                                */
/* ------------------------------------------------------------------------------------------ */

const SETTINGS_FIELDS = ['name', 'base_currency', 'home_country'] as const

export async function updateOrganizationSettings(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await requireActiveOrganization(formData)
  if (!guard.ok) return guard.state
  const { organizationId } = guard
  const values = fieldValues(formData, SETTINGS_FIELDS)
  const arabicEnabled = checkboxValue(formData, 'arabic_enabled')

  const parsed = organizationSettingsSchema.safeParse({ ...values, arabic_enabled: arabicEnabled })
  if (!parsed.success) {
    const t = await getTranslations('Validation')
    return { status: 'error', ...fieldErrorsFrom(parsed.error, t), values, code: 'validation' }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('update_organization_settings', {
    p_organization_id: organizationId,
    p_name: parsed.data.name,
    p_base_currency: parsed.data.base_currency,
    p_home_country: parsed.data.home_country,
    p_arabic_enabled: parsed.data.arabic_enabled,
  })
  if (error) return { ...(await rpcErrorState(error)), values }

  // The name shows in the sidebar switcher and the Arabic toggle gates the language card.
  revalidatePath('/', 'layout')
  const t = await getTranslations('Settings.organization')
  return { status: 'success', message: t('saved'), values }
}

/* ------------------------------------------------------------------------------------------ */
/* Members                                                                                     */
/* ------------------------------------------------------------------------------------------ */

export async function setMemberRole(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await requireActiveOrganization(formData)
  if (!guard.ok) return guard.state
  const { organizationId } = guard
  const userId = uuidSchema.safeParse(formData.get('user_id'))
  const role = roleSchema.safeParse(formData.get('role'))
  if (!userId.success) return invalidState('invalid_user')
  if (!role.success) {
    const t = await getTranslations('Validation')
    return { status: 'error', fieldErrors: { role: t('invalidRole') }, code: 'invalid_role' }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('set_member_role', {
    p_organization_id: organizationId,
    p_user_id: userId.data,
    p_role: role.data,
  })
  if (error) return rpcErrorState(error)

  revalidatePath('/settings')
  const t = await getTranslations('Members')
  return { status: 'success', message: t('saved') }
}

export async function removeMember(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await requireActiveOrganization(formData)
  if (!guard.ok) return guard.state
  const { context, organizationId } = guard
  const userId = uuidSchema.safeParse(formData.get('user_id'))
  if (!userId.success) return invalidState('invalid_user')

  const supabase = await createClient()
  const { error } = await supabase.rpc('remove_member', {
    p_organization_id: organizationId,
    p_user_id: userId.data,
  })
  if (error) return rpcErrorState(error)

  revalidatePath('/', 'layout')
  // Leaving: the token still names this organization, so the hub re-selects one.
  if (userId.data === context.userId) redirect('/organizations')
  return { status: 'success' }
}

export async function setMemberLocations(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await requireActiveOrganization(formData)
  if (!guard.ok) return guard.state
  const { organizationId } = guard
  const userId = uuidSchema.safeParse(formData.get('user_id'))
  const locationIds = locationIdsSchema.safeParse(formData.getAll('location_ids'))
  if (!userId.success) return invalidState('invalid_user')
  if (!locationIds.success) return invalidState('invalid_locations')

  const supabase = await createClient()
  const { error } = await supabase.rpc('set_member_locations', {
    p_organization_id: organizationId,
    p_user_id: userId.data,
    p_location_ids: locationIds.data,
  })
  if (error) return rpcErrorState(error)

  revalidatePath('/settings')
  const t = await getTranslations('Members')
  return { status: 'success', message: t('saved') }
}

/* ------------------------------------------------------------------------------------------ */
/* Invitations                                                                                 */
/* ------------------------------------------------------------------------------------------ */

type InviteResult = { id: string; email: string; resend: boolean }

/** Translates invite_member's SQLSTATEs into the InviteMembers messages where they are specific. */
async function inviteErrorState(error: RpcErrorLike, email: string): Promise<ActionState> {
  const t = await getTranslations('InviteMembers.errors')
  const message = error?.message ?? ''
  if (isRpcCode(error, 'MQ409')) {
    return { status: 'error', message: t('alreadyMember', { email }), code: 'MQ409' }
  }
  if (isRpcCode(error, 'MQ429')) {
    const key = /two minutes/i.test(message) ? 'cooldown' : 'tooMany'
    return { status: 'error', message: t(key), code: 'MQ429' }
  }
  if (isRpcCode(error, 'MQ422') && /owner/i.test(message)) {
    return { status: 'error', message: t('roleCeiling'), code: 'MQ422' }
  }
  return rpcErrorState(error)
}

async function emailErrorState(error: AuthError): Promise<ActionState> {
  if (error.code === 'over_email_send_rate_limit' || error.status === 429) {
    const t = await getTranslations('InviteMembers.errors')
    return { status: 'error', message: t('emailRateLimited'), code: error.code ?? 'rate_limited' }
  }
  if (error.code === 'email_address_not_authorized') {
    const t = await getTranslations('InviteMembers.errors')
    return { status: 'error', message: t('emailNotAuthorized'), code: error.code }
  }
  const t = await getTranslations('RpcErrors')
  return { status: 'error', message: t('generic'), code: error.code ?? 'email_failed' }
}

/**
 * Delivers the invitation e-mail. New addresses get Supabase's invite (which also creates the
 * user, sign-up being disabled); an address that already has an account gets a magic link instead,
 * sent through a cookie-less client so the inviter's own session is untouched. Both land on
 * /invitations/<id> once the link is verified.
 */
async function sendInvitationEmail(invitation: InviteResult): Promise<ActionState | null> {
  const redirectTo = `${await siteOrigin()}/invitations/${invitation.id}`

  const admin = createAdminClient()
  const { error } = await admin.auth.admin.inviteUserByEmail(invitation.email, { redirectTo })
  if (!error) return null
  if (error.code !== 'email_exists') return emailErrorState(error)

  const anonymous = createSupabaseClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  )
  const { error: otpError } = await anonymous.auth.signInWithOtp({
    email: invitation.email,
    options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
  })
  return otpError ? emailErrorState(otpError) : null
}

async function sentState(invitation: InviteResult): Promise<ActionState> {
  const t = await getTranslations('InviteMembers')
  return {
    status: 'success',
    message: t(invitation.resend ? 'resentTo' : 'sentTo', { email: invitation.email }),
  }
}

export async function inviteMember(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await requireActiveOrganization(formData)
  if (!guard.ok) return guard.state
  const { organizationId } = guard
  const values = fieldValues(formData, ['email', 'role'])

  const parsed = inviteSchema.safeParse(values)
  if (!parsed.success) {
    const t = await getTranslations('Validation')
    return { status: 'error', ...fieldErrorsFrom(parsed.error, t), values, code: 'validation' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('invite_member', {
    p_organization_id: organizationId,
    p_email: parsed.data.email,
    p_role: parsed.data.role,
  })
  const invitation = data?.[0]
  if (error || !invitation) return { ...(await inviteErrorState(error, parsed.data.email)), values }

  revalidatePath('/settings')
  const sendError = await sendInvitationEmail(invitation)
  if (sendError) return { ...sendError, values }
  return sentState(invitation)
}

export async function resendInvitation(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await requireActiveOrganization(formData)
  if (!guard.ok) return guard.state
  const { organizationId } = guard
  const invitationId = uuidSchema.safeParse(formData.get('invitation_id'))
  if (!invitationId.success) return invalidState('invalid_invitation')

  const supabase = await createClient()
  const { data: row, error: readError } = await supabase
    .from('organization_invitations')
    .select('id, email, role, organization_id')
    .eq('id', invitationId.data)
    .eq('organization_id', organizationId)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .maybeSingle()
  if (readError) return rpcErrorState(readError)
  if (!row) return rpcErrorState({ code: 'MQ404' })

  const email = emailSchema.safeParse(row.email)
  const role = roleSchema.safeParse(row.role)
  if (!email.success || !role.success) return rpcErrorState({ code: 'MQ404' })

  // invite_member re-arms the pending row (cooldown, send cap, 7 more days) and returns resend=true.
  const { data, error } = await supabase.rpc('invite_member', {
    p_organization_id: organizationId,
    p_email: email.data,
    p_role: role.data,
  })
  const invitation = data?.[0]
  if (error || !invitation) return inviteErrorState(error, email.data)

  revalidatePath('/settings')
  const sendError = await sendInvitationEmail(invitation)
  if (sendError) return sendError
  return sentState({ ...invitation, resend: true })
}

export async function revokeInvitation(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await requireActiveOrganization(formData)
  if (!guard.ok) return guard.state
  const invitationId = uuidSchema.safeParse(formData.get('invitation_id'))
  if (!invitationId.success) return invalidState('invalid_invitation')

  const supabase = await createClient()
  const { error } = await supabase.rpc('revoke_invitation', { p_invitation_id: invitationId.data })
  if (error) return rpcErrorState(error)

  revalidatePath('/settings')
  return { status: 'success' }
}

/* ------------------------------------------------------------------------------------------ */
/* Account                                                                                     */
/* ------------------------------------------------------------------------------------------ */

export async function setPassword(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireClaims()
  const parsed = passwordSchema.safeParse(String(formData.get('password') ?? ''))
  if (!parsed.success) {
    const t = await getTranslations('Auth.errors')
    return {
      status: 'error',
      fieldErrors: { password: t('passwordTooShort') },
      code: 'password_too_short',
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password: parsed.data })
  if (error) {
    const t = await getTranslations('Auth.errors')
    const weak = error.code === 'weak_password'
    return {
      status: 'error',
      message: weak ? t('passwordTooShort') : t('generic'),
      code: error.code ?? 'update_failed',
    }
  }

  const t = await getTranslations('Settings.account')
  return { status: 'success', message: t('saved') }
}
