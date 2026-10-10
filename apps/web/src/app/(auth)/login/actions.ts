'use server'

import type { AuthError } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { siteOrigin } from '@/lib/auth/origin'
import { createClient } from '@/lib/supabase/server'

export type SignInError =
  'invalidEmail' | 'passwordRequired' | 'invalidCredentials' | 'rateLimited' | 'generic'

export type SignInState = {
  error?: SignInError
  sentTo?: string
}

const emailSchema = z.email()

/** One action for both buttons on the login form; the clicked button sets `intent`. */
export async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const intent = formData.get('intent')
  const parsedEmail = emailSchema.safeParse(String(formData.get('email') ?? '').trim())
  if (!parsedEmail.success) return { error: 'invalidEmail' }
  const email = parsedEmail.data

  const supabase = await createClient()

  if (intent === 'magic-link') {
    const origin = await siteOrigin()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // The sign-in template links to /auth/confirm?…&next={{ .RedirectTo }}; same-origin
        // absolute destinations are reduced to a path there (safeDestination).
        emailRedirectTo: `${origin}/dashboard`,
        // Invitation-only: the login form never creates users. Accounts come from
        // auth.admin.inviteUserByEmail (Settings > Members) or `pnpm db:user` locally.
        shouldCreateUser: false,
      },
    })
    // An address without an account gets the same neutral status as a real one, and so does a
    // per-address rate limit (GoTrue only rate-limits addresses that exist), so the form cannot be
    // used to find out who is a member.
    if (error && !isNeutral(error)) return { error: mapAuthError(error) }
    return { sentTo: email }
  }

  const password = String(formData.get('password') ?? '')
  if (!password) return { error: 'passwordRequired' }

  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error: mapAuthError(error) }

  redirect('/dashboard')
}

/**
 * Errors that would reveal whether an address has an account. GoTrue refuses an OTP for an address
 * without a user with otp_disabled ("Signups not allowed for otp") when shouldCreateUser is false,
 * or with signup_disabled when sign-ups are off project-wide; it rate-limits (429,
 * over_email_send_rate_limit) and refuses unauthorized recipients only for addresses that exist.
 */
function isNeutral(error: AuthError): boolean {
  if (error.code === 'otp_disabled' || error.code === 'signup_disabled') return true
  if (error.code === 'over_email_send_rate_limit' || error.status === 429) return true
  if (error.code === 'email_address_not_authorized') return true
  return /signups? not allowed/i.test(error.message)
}

function mapAuthError(error: AuthError): SignInError {
  if (error.status === 429 || error.code === 'over_email_send_rate_limit') return 'rateLimited'
  if (error.code === 'invalid_credentials') return 'invalidCredentials'
  return 'generic'
}
