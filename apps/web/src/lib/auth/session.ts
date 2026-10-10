import { redirect } from 'next/navigation'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { describeRejectedClaims, parseClaims, type MaqdarClaims } from './claims'

/** Verified claims of the current session, or null. Memoised for the duration of one request. */
export const getSessionClaims = cache(async (): Promise<MaqdarClaims | null> => {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  if (error) {
    // Logged without the token; shows up in the Worker logs when a session is rejected.
    console.warn('session: getClaims failed', {
      code: error.code,
      status: error.status,
      message: error.message,
    })
    return null
  }
  if (!data?.claims) return null
  const claims = parseClaims(data.claims)
  if (!claims) console.warn('session: claims rejected', describeRejectedClaims(data.claims))
  return claims
})

/**
 * Claims or a redirect to /login. Call it first in every page, layout and Server Action; the
 * database still enforces every rule, this only decides what to render.
 */
export async function requireClaims(): Promise<MaqdarClaims> {
  const claims = await getSessionClaims()
  if (!claims) redirect('/login')
  return claims
}
