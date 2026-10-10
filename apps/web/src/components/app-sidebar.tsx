'use client'

import {
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
} from '@/components/ui/sidebar'
import { signOut } from '@/lib/auth/actions'
import type { Role } from '@/lib/auth/roles'
import type { OrganizationSummary } from '@/lib/organizations/context'

const NAV_ITEMS = [
  { key: 'dashboard', href: '/dashboard', icon: LayoutDashboard },
  { key: 'items', href: '/items', icon: Package },
  { key: 'locations', href: '/locations', icon: MapPin },
  { key: 'suppliers', href: '/suppliers', icon: Truck },
  { key: 'forecasts', href: '/forecasts', icon: TrendingUp },
  { key: 'replenishment', href: '/replenishment', icon: ShoppingCart },
  { key: 'settings', href: '/settings', icon: Settings },
] as const

export type AppSidebarProps = {
  user: { email: string }
  organizations: OrganizationSummary[]
  active: OrganizationSummary
  role: Role | null
  pendingInvitationCount: number
}

export function AppSidebar({
  user,
  organizations,
  active,
  role,
  pendingInvitationCount,
}: AppSidebarProps) {
  const t = useTranslations('Nav')
  const tCommon = useTranslations('Common')
  const pathname = usePathname()
  const dir = useDirection()

  return (
    // The sidebar's `side` is physical by design; it follows the text direction.
    <Sidebar collapsible="icon" side={dir === 'rtl' ? 'right' : 'left'} dir={dir}>
      <SidebarHeader className="gap-2">
        <Link
          href="/dashboard"
          className="px-2 pt-1 font-semibold tracking-tight group-data-[collapsible=icon]:hidden"
        >
          {tCommon('appName')}
        </Link>
        <OrganizationSwitcher
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
              {NAV_ITEMS.map(({ key, href, icon: Icon }) => {
                const isActive = pathname === href || pathname.startsWith(`${href}/`)
                return (
                  <SidebarMenuItem key={key}>
                    <SidebarMenuButton
                      render={<Link href={href} />}
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
        <div className="flex flex-col gap-1 px-2 group-data-[collapsible=icon]:hidden">
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
