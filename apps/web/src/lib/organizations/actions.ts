'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireClaims } from '@/lib/auth/session'
import { checkboxValue, fieldValues, type ActionState } from '@/lib/forms'
import { createOrganizationSchema } from '@/lib/organizations/schemas'
import { isRpcCode, rpcErrorKey } from '@/lib/rpc-errors'
import { createClient } from '@/lib/supabase/server'
import { fieldErrorsFrom } from '@/lib/validation'

/**
 * Mints a token that carries the organization recorded by set_active_organization() or the RPCs.
 * Refresh tokens are single-use: this is the only place the app refreshes, always inside a Server
 * Action right after the database write, never in Server Components or the browser.
 */
async function refreshClaims(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.auth.refreshSession()
  if (error) redirect('/login')
}

/** Makes the organization active and reloads the app with a fresh token. */
export async function switchOrganization(organizationId: string): Promise<void> {
  await requireClaims()
  const supabase = await createClient()
  const { error } = await supabase.rpc('set_active_organization', {
    p_organization_id: organizationId,
  })
  if (error) redirect(`/organizations?error=${rpcErrorKey(error)}`)
  await refreshClaims(supabase)
  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

/** Form action: `invitationId` hidden field. Joins the organization and opens it. */
export async function acceptInvitation(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireClaims()
  const invitationId = String(formData.get('invitationId') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.rpc('accept_invitation', { p_invitation_id: invitationId })
  if (error) {
    const t = await getTranslations('RpcErrors')
    const key = rpcErrorKey(error)
    return { status: 'error', message: t(key), code: error.code ?? key }
  }
  await refreshClaims(supabase)
  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

const CREATE_ORGANIZATION_FIELDS = ['name', 'slug', 'base_currency', 'home_country'] as const

/**
 * Form action for /organizations/new. Validates with createOrganizationSchema, calls
 * create_organization() (which also makes the caller owner and the organization active), mints a
 * token carrying the new org_id and opens the dashboard.
 */
export async function createOrganization(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireClaims()
  const arabicEnabled = checkboxValue(formData, 'arabic_enabled')
  const values = {
    ...fieldValues(formData, CREATE_ORGANIZATION_FIELDS),
    arabic_enabled: arabicEnabled ? 'on' : '',
  }

  const parsed = createOrganizationSchema.safeParse({ ...values, arabic_enabled: arabicEnabled })
  if (!parsed.success) {
    const t = await getTranslations('Validation')
    return { status: 'error', ...fieldErrorsFrom(parsed.error, t), values, code: 'validation' }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('create_organization', {
    p_slug: parsed.data.slug,
    p_name: parsed.data.name,
    p_base_currency: parsed.data.base_currency,
    p_home_country: parsed.data.home_country,
    p_arabic_enabled: parsed.data.arabic_enabled,
  })
  if (error) {
    const code = error.code ?? rpcErrorKey(error)
    if (isRpcCode(error, '23505')) {
      const t = await getTranslations('Organizations.errors')
      return { status: 'error', fieldErrors: { slug: t('slugTaken') }, values, code }
    }
    if (isRpcCode(error, 'MQ429')) {
      const t = await getTranslations('Organizations.errors')
      return { status: 'error', message: t('tooMany'), values, code }
    }
    const t = await getTranslations('RpcErrors')
    return { status: 'error', message: t(rpcErrorKey(error)), values, code }
  }

  await refreshClaims(supabase)
  revalidatePath('/', 'layout')
  redirect('/dashboard')
}
