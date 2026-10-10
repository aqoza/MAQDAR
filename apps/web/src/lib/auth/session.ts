import { redirect } from 'next/navigation'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { parseClaims, type MaqdarClaims } from './claims'

/** Verified claims of the current session, or null. Memoised for the duration of one request. */
export const getSessionClaims = cache(async (): Promise<MaqdarClaims | null> => {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  return parseClaims(data?.claims)
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
