'use client'

import {
  FileUp,
  LayoutDashboard,
  LogOut,
  MapPin,
  Package,
  Settings,
  ShoppingCart,
  TrendingUp,
  Truck,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { MouseEvent } from 'react'
import { ZeeSpareMark } from '@/components/zeespare-mark'
import { OrganizationSwitcher } from '@/components/organization-switcher'
import { RoleBadge } from '@/components/role-badge'
import { Button } from '@/components/ui/button'
import { useDirection } from '@/components/ui/direction'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from '@/components/ui/sidebar'
import { signOut } from '@/lib/auth/actions'
import { isEditorRole, type Role } from '@/lib/auth/roles'
import { SupplierPortalSidebar } from '@/components/supplier-portal-sidebar'
import type { OrganizationSummary } from '@/lib/organizations/context'

// `editorsOnly` items are hidden from approvers, branch users and viewers (the pages 404 for them).
const NAV_ITEMS = [
  { key: 'dashboard', href: '/dashboard', icon: LayoutDashboard, editorsOnly: false },
  { key: 'items', href: '/items', icon: Package, editorsOnly: false },
  { key: 'locations', href: '/locations', icon: MapPin, editorsOnly: false },
  { key: 'suppliers', href: '/suppliers', icon: Truck, editorsOnly: false },
  { key: 'imports', href: '/imports', icon: FileUp, editorsOnly: true },
  { key: 'forecasts', href: '/forecasts', icon: TrendingUp, editorsOnly: false },
  { key: 'replenishment', href: '/replenishment', icon: ShoppingCart, editorsOnly: false },
  { key: 'settings', href: '/settings', icon: Settings, editorsOnly: false },
] as const

export type AppSidebarProps = {
  user: { email: string }
  organizations: OrganizationSummary[]
  active: OrganizationSummary
  role: Role | null
  workspaceLocked?: boolean
  pendingInvitationCount: number
}

export function AppSidebar(props: AppSidebarProps | { portal: true; user: { email: string } }) {
  return 'portal' in props ? (
    <SupplierPortalSidebar email={props.user.email} />
  ) : (
    <OrganizationSidebar {...props} />
  )
}

function OrganizationSidebar({
  user,
  organizations,
  active,
  role,
  pendingInvitationCount,
  workspaceLocked = false,
}: AppSidebarProps) {
  const t = useTranslations('Nav')
  const tCommon = useTranslations('Common')
  const pathname = usePathname()
  const dir = useDirection()
  const { isMobile, setOpenMobile } = useSidebar()
  const canEdit = isEditorRole(role)
  const navItems = NAV_ITEMS.filter((item) => canEdit || !item.editorsOnly)

  function closeMobileNavigation(event: MouseEvent<HTMLAnchorElement>) {
    if (
      isMobile &&
      !event.defaultPrevented &&
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey
    ) {
      setOpenMobile(false)
    }
  }

  return (
    // The sidebar's `side` is physical by design; it follows the text direction.
    <Sidebar collapsible="icon" side={dir === 'rtl' ? 'right' : 'left'} dir={dir}>
      <SidebarHeader className="gap-2 app-sidebar-header">
        <Link
          href="/dashboard"
          prefetch={pathname === '/dashboard' ? false : null}
          onClick={closeMobileNavigation}
          className="app-brand flex items-center gap-2 px-2 pt-1 font-semibold tracking-tight max-md:min-h-11 group-data-[collapsible=icon]:hidden"
        >
          <ZeeSpareMark className="text-primary size-6 shrink-0" />
          <span dir="ltr">{tCommon('appName')}</span>
        </Link>
        <OrganizationSwitcher
          workspaceLocked={workspaceLocked}
          organizations={organizations}
          active={active}
          role={role}
          pendingInvitationCount={pendingInvitationCount}
        />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map(({ key, href, icon: Icon }) => {
                const isActive = pathname === href || pathname.startsWith(`${href}/`)
                return (
                  <SidebarMenuItem key={key}>
                    <SidebarMenuButton
                      className="max-md:min-h-11"
                      render={
                        <Link
                          href={href}
                          prefetch={pathname === '/dashboard' ? false : null}
                          onClick={closeMobileNavigation}
                        />
                      }
                      isActive={isActive}
                      tooltip={t(key)}
                    >
                      <Icon />
                      <span>{t(key)}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarSeparator />
        <div className="app-account flex flex-col gap-1 px-2 group-data-[collapsible=icon]:hidden">
          <p className="text-muted-foreground truncate text-xs" title={user.email}>
            <span className="sr-only">{tCommon('signedInAs')} </span>
            {user.email}
          </p>
          {role ? <RoleBadge role={role} variant="outline" /> : null}
        </div>
        <form action={signOut}>
          <Button type="submit" variant="ghost" size="sm" className="w-full justify-start">
            <LogOut />
            <span className="group-data-[collapsible=icon]:hidden">{tCommon('signOut')}</span>
          </Button>
        </form>
      </SidebarFooter>
    </Sidebar>
  )
}
