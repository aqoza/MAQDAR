'use server'

import { createClient as createSupabaseClient, type AuthError } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { API_SCOPES } from '@/lib/api/auth'
import { generateApiKey } from '@/lib/api/keys'
import { API_LIMITS } from '@/lib/api/limits'
import { siteOrigin } from '@/lib/auth/origin'
import { isAdminRole } from '@/lib/auth/roles'
import { requireClaims } from '@/lib/auth/session'
import { env } from '@/lib/env'
import { checkboxValue, fieldValues, type ActionState } from '@/lib/forms'
import { invalidState, requireActiveOrganization, rpcErrorState } from '@/lib/organizations/guard'
import {
  emailSchema,
  inviteSchema,
  organizationPreferencesSchema,
  organizationSettingsSchema,
  roleSchema,
} from '@/lib/organizations/schemas'
import { isRpcCode, type RpcErrorLike } from '@/lib/rpc-errors'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { fieldErrorsFrom } from '@/lib/validation'
import {
  API_KEY_FIELDS,
  apiKeyErrorFields,
  apiKeyFormSchema,
  isApiKeyField,
  type ApiKeyField,
} from './api-keys'

/*
 * Every action re-checks the session, reads the organization from the active context (never from
 * the form) and lets the database enforce the rules; what comes back is translated for the form.
 */

const uuidSchema = z.uuid()
const locationIdsSchema = z.array(uuidSchema).max(1000)
const passwordSchema = z.string().min(8).max(72)

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
/* Preferences                                                                                 */
/* ------------------------------------------------------------------------------------------ */

const PREFERENCE_FIELDS = ['default_locale', 'time_zone', 'numbering_system'] as const
type PreferenceField = (typeof PREFERENCE_FIELDS)[number]

function isPreferenceField(value: unknown): value is PreferenceField {
  return typeof value === 'string' && (PREFERENCE_FIELDS as readonly string[]).includes(value)
}

/**
 * Field errors for the preference selects. Values only fail through a tampered form or a stale
 * page (Arabic switched off meanwhile), so each field gets one message naming the valid choices.
 */
async function preferenceErrorState(
  fields: Iterable<PreferenceField>,
  defaultLocale: string,
  code: string,
): Promise<ActionState> {
  const t = await getTranslations('Settings.preferences.errors')
  const fieldErrors: Record<string, string> = {}
  for (const field of fields) {
    if (field === 'default_locale') {
      fieldErrors[field] = defaultLocale === 'ar' ? t('arabicRequired') : t('defaultLocale')
    } else if (field === 'time_zone') {
      fieldErrors[field] = t('timeZone')
    } else {
      fieldErrors[field] = t('numberingSystem')
    }
  }
  return { status: 'error', fieldErrors, code }
}

export async function updatePreferences(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await requireActiveOrganization(formData)
  if (!guard.ok) return guard.state
  const { organizationId } = guard
  const values = fieldValues(formData, PREFERENCE_FIELDS)

  const parsed = organizationPreferencesSchema.safeParse(values)
  if (!parsed.success) {
    const fields = new Set(
      parsed.error.issues.map((issue) => issue.path[0]).filter(isPreferenceField),
    )
    return { ...(await preferenceErrorState(fields, values.default_locale, 'validation')), values }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('update_organization_preferences', {
    p_organization_id: organizationId,
    p_default_locale: parsed.data.default_locale,
    // Empty follows the home country's zone; the RPC stores it as null.
    p_time_zone: parsed.data.time_zone,
    p_numbering_system: parsed.data.numbering_system,
  })
  if (error) {
    // MQ422 names the offending parameter in the hint (default_locale, time_zone, numbering_system).
    if (isRpcCode(error, 'MQ422') && isPreferenceField(error.hint)) {
      return {
        ...(await preferenceErrorState([error.hint], parsed.data.default_locale, 'MQ422')),
        values,
      }
    }
    return { ...(await rpcErrorState(error)), values }
  }

  // Locale, digits and time zone are read by the i18n request config for every page.
  revalidatePath('/', 'layout')
  const t = await getTranslations('Settings.preferences')
  // No values: the form re-fills from the refreshed organization, so a later change made elsewhere
  // (turning Arabic off resets the default language) is not masked by this submission.
  return { status: 'success', message: t('saved') }
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
/* API keys                                                                                    */
/* ------------------------------------------------------------------------------------------ */

/**
 * The create form's state. On success `secret` carries the new key, the only time it leaves the
 * server: the form shows it once and drops it. It is never logged, stored or put in `values`.
 */
export type ApiKeyActionState = ActionState & { secret?: string; name?: string }

const API_KEY_ERROR_KEYS = {
  name: 'name',
  scopes: 'scopes',
  expires_in_days: 'expiry',
} as const satisfies Record<ApiKeyField, string>

async function apiKeyFieldErrorState(fields: Iterable<ApiKeyField>, code: string) {
  const t = await getTranslations('ApiKeys.errors')
  const fieldErrors: Record<string, string> = {}
  for (const field of fields) fieldErrors[field] = t(API_KEY_ERROR_KEYS[field])
  return { status: 'error', fieldErrors, code } satisfies ActionState
}

/**
 * create_api_key's errors: the 20-key limit (MQ409 hint `api_keys`) and MQ422 naming a form field
 * get their own messages; the rest (role, stale organization, internal fields) the RpcErrors ones.
 */
async function apiKeyErrorState(error: RpcErrorLike): Promise<ActionState> {
  if (isRpcCode(error, 'MQ409') && error?.hint?.trim() === 'api_keys') {
    const t = await getTranslations('ApiKeys.errors')
    return {
      status: 'error',
      message: t('tooMany', { max: API_LIMITS.activeKeysPerOrganization }),
      code: 'MQ409',
    }
  }
  const hint = error?.hint?.trim()
  if (isRpcCode(error, 'MQ422') && isApiKeyField(hint))
    return apiKeyFieldErrorState([hint], 'MQ422')
  return rpcErrorState(error)
}

/**
 * Creates a key for the active organization (owners and admins). The key is generated here, only
 * its SHA-256 and display parts go to create_api_key, and the plaintext comes back once.
 */
export async function createApiKey(
  _previous: ApiKeyActionState,
  formData: FormData,
): Promise<ApiKeyActionState> {
  const guard = await requireActiveOrganization(formData)
  if (!guard.ok) return guard.state
  if (!isAdminRole(guard.context.role)) return rpcErrorState({ code: 'MQ403' })
  const { organizationId } = guard
  const scopes = formData.getAll('scopes').filter((value) => typeof value === 'string')
  const fields = fieldValues(formData, API_KEY_FIELDS)
  // Re-fills the form after an error; the scopes as one comma-separated value.
  const values: Record<string, string> = { ...fields, scopes: scopes.join(',') }

  const parsed = apiKeyFormSchema(API_SCOPES, API_LIMITS.keyExpiryDays).safeParse({
    name: fields.name,
    scopes,
    expires_in_days: fields.expires_in_days,
  })
  if (!parsed.success) {
    const fields = apiKeyErrorFields(parsed.error.issues)
    return { ...(await apiKeyFieldErrorState(fields, 'validation')), values }
  }

  const key = await generateApiKey()
  const supabase = await createClient()
  const { error } = await supabase.rpc('create_api_key', {
    p_organization_id: organizationId,
    p_name: parsed.data.name,
    p_scopes: parsed.data.scopes,
    p_expires_in_days: parsed.data.expires_in_days,
    p_key_hash: key.hash,
    p_display_prefix: key.displayPrefix,
    p_last4: key.last4,
  })
  if (error) return { ...(await apiKeyErrorState(error)), values }

  revalidatePath('/settings')
  return { status: 'success', secret: key.token, name: parsed.data.name }
}

/** Revokes a key of the active organization at once (owners and admins; a repeat is a no-op). */
export async function revokeApiKey(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await requireActiveOrganization(formData)
  if (!guard.ok) return guard.state
  if (!isAdminRole(guard.context.role)) return rpcErrorState({ code: 'MQ403' })
  const keyId = uuidSchema.safeParse(formData.get('id'))
  if (!keyId.success) return invalidState('invalid_key')

  const supabase = await createClient()
  const { error } = await supabase.rpc('revoke_api_key', { p_key_id: keyId.data })
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
