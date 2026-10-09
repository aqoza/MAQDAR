'use server'

import type { AuthError } from '@supabase/supabase-js'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
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
        emailRedirectTo: `${origin}/auth/callback?next=/dashboard`,
        // Step 1 has no signup page, so the first user is created by magic link.
        // Step 3 switches to invitation-only sign-up.
        shouldCreateUser: true,
      },
    })
    if (error) return { error: mapAuthError(error) }
    return { sentTo: email }
  }

  const password = String(formData.get('password') ?? '')
  if (!password) return { error: 'passwordRequired' }

  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error: mapAuthError(error) }

  redirect('/dashboard')
}

function mapAuthError(error: AuthError): SignInError {
  if (error.status === 429 || error.code === 'over_email_send_rate_limit') return 'rateLimited'
  if (error.code === 'invalid_credentials') return 'invalidCredentials'
  return 'generic'
}

async function siteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL
  if (configured) return configured.replace(/\/$/, '')
  const requestHeaders = await headers()
  const host =
    requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost:3000'
  const protocol = requestHeaders.get('x-forwarded-proto') ?? 'http'
  return `${protocol}://${host}`
}
