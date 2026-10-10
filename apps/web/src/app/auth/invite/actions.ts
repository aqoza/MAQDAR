'use server'

import { redirect } from 'next/navigation'
import { siteOrigin } from '@/lib/auth/origin'
import { safeDestination } from '@/lib/auth/redirects'
import type { ActionState } from '@/lib/forms'
import { createClient } from '@/lib/supabase/server'

/**
 * Completes an invitation link. The e-mail points at a GET page that only renders a button; the
 * one-time token is consumed here, by POST, on purpose: mail gateways and link scanners prefetch
 * GET links, which would burn the token before the invitee ever clicks it. verifyOtp through the
 * server client sets the session cookies, then the user is asked to pick a password.
 */
export async function completeInvite(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const tokenHash = formData.get('token_hash')
  const next = formData.get('next')
  if (typeof tokenHash !== 'string' || !tokenHash) redirect('/login?error=inviteExpired')

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ type: 'invite', token_hash: tokenHash })
  // otp_expired, an already used hash or any other failure: the link is dead and only a new
  // invitation helps, so every error lands on the same login message.
  if (error) redirect('/login?error=inviteExpired')

  const destination = safeDestination(typeof next === 'string' ? next : null, await siteOrigin())
  redirect(`/auth/set-password?next=${encodeURIComponent(destination)}`)
}
