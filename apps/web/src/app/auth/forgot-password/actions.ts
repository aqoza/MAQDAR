'use server'

import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { siteOrigin } from '@/lib/auth/origin'
import { requireClaims } from '@/lib/auth/session'
import type { ActionState } from '@/lib/forms'
import { createClient } from '@/lib/supabase/server'
import { setPassword } from '../set-password/actions'

/** Never creates an account or exposes whether the requested mailbox is registered. */
export async function requestPasswordReset(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const t = await getTranslations('Auth')
  const parsed = z
    .email()
    .max(254)
    .safeParse(String(formData.get('email') ?? '').trim())
  if (!parsed.success) return { status: 'error', message: t('errors.invalidEmail') }
  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${await siteOrigin()}/auth/recover`,
  })
  // These account-dependent responses must be indistinguishable from an unknown mailbox.
  const neutralCodes = [
    'over_email_send_rate_limit',
    'email_address_not_authorized',
    'user_not_found',
    'email_not_confirmed',
    'signup_disabled',
  ]
  if (error && error.status !== 429 && !neutralCodes.includes(error.code ?? '')) {
    return { status: 'error', message: t('errors.generic') }
  }
  return { status: 'success', message: t('recovery.sent') }
}

/** GET only shows a confirmation. Verify the single-use token after a deliberate POST. */
export async function completeRecovery(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = formData.get('token_hash')
  const code = formData.get('code')
  const isToken = typeof token === 'string' && /^[a-z0-9_-]{20,256}$/i.test(token)
  const isCode = typeof code === 'string' && /^[a-z0-9_-]{20,256}$/i.test(code)
  if ((!isToken && !isCode) || (isToken && isCode)) {
    redirect('/auth/forgot-password?error=link')
  }
  const supabase = await createClient()
  const { error } = isToken
    ? await supabase.auth.verifyOtp({ type: 'recovery', token_hash: token })
    : await supabase.auth.exchangeCodeForSession(code as string)
  if (error) redirect('/auth/forgot-password?error=link')
  redirect('/auth/reset-password')
}

/** Reuse the authenticated password update; never trust a submitted destination. */
export async function resetPassword(
  previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireClaims()
  const t = await getTranslations('Auth')
  const password = formData.get('password')
  if (typeof password !== 'string' || password !== formData.get('confirmation')) {
    return { status: 'error', message: t('recovery.mismatch') }
  }
  const update = new FormData()
  update.set('password', password)
  update.set('next', '/dashboard')
  return setPassword(previous, update)
}
