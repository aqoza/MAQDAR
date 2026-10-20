import type { Database } from '@maqdar/shared/database.types'
import { cache } from 'react'
import { requestSite } from '@/lib/workspaces/request'
import { workspaceAllows, type Workspace } from '@/lib/workspaces/hosts'
import {
  type AppLocale,
  type NumberingSystem,
  defaultLocale,
  defaultNumberingSystem,
  isAppLocale,
  isNumberingSystem,
} from '@/i18n/config'
import type { MaqdarClaims } from '@/lib/auth/claims'
import { isRole, type Role } from '@/lib/auth/roles'
import { getSessionClaims } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'

type OrganizationRow = Database['public']['Functions']['my_organizations']['Returns'][number]

/**
 * One row of my_organizations(), with the display preferences typed as the database constrains
 * them (the generated types cannot express check constraints or nullable function columns).
 */
export type OrganizationSummary = Omit<
  OrganizationRow,
  'default_locale' | 'numbering_system' | 'time_zone'
> & {
  /** Language for members without a locale cookie; `ar` only while Arabic is enabled. */
  default_locale: AppLocale
  /** Digits in the Arabic interface. */
  numbering_system: NumberingSystem
  /** The chosen IANA zone; null follows the home country (see effective_time_zone). */
  time_zone: string | null
}
export type PendingInvitation = Database['public']['Functions']['my_invitations']['Returns'][number]

export type ActiveContext = {
  workspace: Workspace | null
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

function toSummary(row: OrganizationRow): OrganizationSummary {
  return {
    ...row,
    default_locale: isAppLocale(row.default_locale) ? row.default_locale : defaultLocale,
    numbering_system: isNumberingSystem(row.numbering_system)
      ? row.numbering_system
      : defaultNumberingSystem,
    time_zone: row.time_zone || null,
  }
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

  const { workspace } = await requestSite()
  const organizations = (organizationsResult.data ?? [])
    .filter((organization) => workspaceAllows(workspace, organization.id))
    .map(toSummary)
  const active = claims.org_id
    ? (organizations.find((organization) => organization.id === claims.org_id) ?? null)
    : null

  return {
    workspace,
    userId: claims.sub,
    email: claims.email ?? null,
    claims,
    organizations,
    active,
    role: active && isRole(active.role) ? active.role : null,
    invitations: (invitationsResult.data ?? []).filter((invitation) =>
      workspaceAllows(workspace, invitation.organization_id),
    ),
  }
})
