import type { EmailOtpType } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import type { NextRequest } from 'next/server'
import { siteOrigin } from '@/lib/auth/origin'
import { safeDestination } from '@/lib/auth/redirects'
import { createClient } from '@/lib/supabase/server'

/**
 * Completes e-mail links built with a token hash (sign-in links, first sign-in confirmations).
 * `next` may be a path or an absolute URL on this site ({{ .RedirectTo }} in the templates).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = safeDestination(searchParams.get('next'), await siteOrigin())

  if (tokenHash && type) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    if (!error) redirect(next)
  }

  redirect('/login?error=link')
}
