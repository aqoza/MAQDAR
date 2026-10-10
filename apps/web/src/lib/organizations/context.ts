import type { Database } from '@maqdar/shared/database.types'
import { cache } from 'react'
import type { MaqdarClaims } from '@/lib/auth/claims'
import { isRole, type Role } from '@/lib/auth/roles'
import { getSessionClaims } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'

export type OrganizationSummary =
  Database['public']['Functions']['my_organizations']['Returns'][number]
export type PendingInvitation = Database['public']['Functions']['my_invitations']['Returns'][number]

export type ActiveContext = {
  userId: string
  email: string | null
  claims: MaqdarClaims
  /** Every organization the user belongs to, with their role (from the database, never stale). */
  organizations: OrganizationSummary[]
  /** The organization named by the token's org_id claim, when the user is still a member of it. */
  active: OrganizationSummary | null
  /** Role in the active organization, read from the database rather than the token. */
  role: Role | null
  invitations: PendingInvitation[]
}

/**
 * Who is signed in, which organizations they belong to and which one the current token names.
 * `active` is null when the user has no memberships, when the token predates the hook or when the
 * claim points at an organization they left: the app layout then sends them to /organizations,
 * where opening an organization mints a fresh token. Memoised per request (layout, pages, i18n).
 */
export const getActiveContext = cache(async (): Promise<ActiveContext | null> => {
  const claims = await getSessionClaims()
  if (!claims) return null

  const supabase = await createClient()
  const [organizationsResult, invitationsResult] = await Promise.all([
    supabase.rpc('my_organizations'),
    supabase.rpc('my_invitations'),
  ])
  const organizations = organizationsResult.data ?? []
  const active = claims.org_id
    ? (organizations.find((organization) => organization.id === claims.org_id) ?? null)
    : null

  return {
    userId: claims.sub,
    email: claims.email ?? null,
    claims,
    organizations,
    active,
    role: active && isRole(active.role) ? active.role : null,
    invitations: invitationsResult.data ?? [],
  }
})
