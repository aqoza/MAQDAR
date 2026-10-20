'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

export type SignInError =
  'invalidEmail' | 'passwordRequired' | 'invalidCredentials' | 'rateLimited' | 'generic'
export type SignInState = { error?: SignInError }

export async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const parsedEmail = z
    .email()
    .max(254)
    .safeParse(String(formData.get('email') ?? '').trim())
  if (!parsedEmail.success) return { error: 'invalidEmail' }
  const password = String(formData.get('password') ?? '')
  if (!password) return { error: 'passwordRequired' }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email: parsedEmail.data, password })
  if (error) {
    if (error.status === 429) return { error: 'rateLimited' }
    return { error: error.code === 'invalid_credentials' ? 'invalidCredentials' : 'generic' }
  }
  redirect('/dashboard')
}
