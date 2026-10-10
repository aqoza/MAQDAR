'use client'

import { createContext, useContext } from 'react'

const ActiveOrganizationContext = createContext<string | null>(null)

/**
 * The organization the current page was rendered for. Forms send it back so a Server Action can
 * refuse when the active organization changed in another tab or window since the page loaded; the
 * action still takes the organization from the session, never from this field.
 */
export function ActiveOrganizationProvider({
  organizationId,
  children,
}: {
  organizationId: string
  children: React.ReactNode
}) {
  return (
    <ActiveOrganizationContext.Provider value={organizationId}>
      {children}
    </ActiveOrganizationContext.Provider>
  )
}

/** Hidden `organization_id` input for forms whose action acts on the active organization. */
export function ActiveOrganizationField() {
  const organizationId = useContext(ActiveOrganizationContext)
  return organizationId ? (
    <input type="hidden" name="organization_id" value={organizationId} />
  ) : null
}
