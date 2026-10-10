'use client'

import { Building2, ChevronsUpDown, Mail, Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useTransition } from 'react'
import { useDirection } from '@/components/ui/direction'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { useIsMobile } from '@/hooks/use-mobile'
import { isRole, type Role } from '@/lib/auth/roles'
import { switchOrganization } from '@/lib/organizations/actions'
import type { OrganizationSummary } from '@/lib/organizations/context'

export type OrganizationSwitcherProps = {
  organizations: OrganizationSummary[]
  active: OrganizationSummary
  role: Role | null
  pendingInvitationCount: number
}

/**
 * Sidebar header control: the active organization with the user's role, a radio list of every
 * organization they belong to (choosing one mints a token for it and reloads the app), and links to
 * create an organization or review pending invitations.
 */
export function OrganizationSwitcher({
  organizations,
  active,
  role,
  pendingInvitationCount,
}: OrganizationSwitcherProps) {
  const t = useTranslations('Organizations.switcher')
  const tRoles = useTranslations('Roles')
  const isMobile = useIsMobile()
  const dir = useDirection()
  const [pending, startTransition] = useTransition()

  function onValueChange(value: unknown) {
    if (typeof value !== 'string' || value === active.id) return
    startTransition(async () => {
      await switchOrganization(value)
    })
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={pending}
            aria-label={t('label')}
            render={
              <SidebarMenuButton
                size="lg"
                className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
              />
            }
          >
            <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg">
              <Building2 className="size-4" />
            </div>
            <div className="grid flex-1 text-start text-sm leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate font-semibold">{active.name}</span>
              <span className="text-muted-foreground truncate text-xs">
                {role ? tRoles(role) : active.slug}
              </span>
            </div>
            <ChevronsUpDown className="ms-auto size-4 group-data-[collapsible=icon]:hidden" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            dir={dir}
            side={isMobile ? 'bottom' : 'inline-end'}
            align="start"
            sideOffset={4}
            className="min-w-56"
          >
            {/* Base UI requires a group label to sit inside a group, or opening the menu throws. */}
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t('label')}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={active.id} onValueChange={onValueChange}>
                {organizations.map((organization) => (
                  <DropdownMenuRadioItem
                    key={organization.id}
                    value={organization.id}
                    disabled={pending}
                    label={organization.name}
                  >
                    <span className="truncate">{organization.name}</span>
                    {isRole(organization.role) ? (
                      <span className="text-muted-foreground ms-auto text-xs">
                        {tRoles(organization.role)}
                      </span>
                    ) : null}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/organizations/new" />}>
              <Plus />
              {t('create')}
            </DropdownMenuItem>
            {pendingInvitationCount > 0 ? (
              <DropdownMenuItem render={<Link href="/organizations" />}>
                <Mail />
                {t('invitations', { count: pendingInvitationCount })}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
