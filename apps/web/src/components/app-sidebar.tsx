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

const NAV_ITEMS = [
  { key: 'dashboard', href: '/dashboard', icon: LayoutDashboard },
  { key: 'items', href: '/items', icon: Package },
  { key: 'locations', href: '/locations', icon: MapPin },
  { key: 'suppliers', href: '/suppliers', icon: Truck },
  { key: 'forecasts', href: '/forecasts', icon: TrendingUp },
  { key: 'replenishment', href: '/replenishment', icon: ShoppingCart },
  { key: 'settings', href: '/settings', icon: Settings },
] as const

export function AppSidebar({ user }: { user: { email: string } }) {
  const t = useTranslations('Nav')
  const tCommon = useTranslations('Common')
  const pathname = usePathname()
  const dir = useDirection()

  return (
    // The sidebar's `side` is physical by design; it follows the text direction.
    <Sidebar collapsible="icon" side={dir === 'rtl' ? 'right' : 'left'} dir={dir}>
      <SidebarHeader className="px-4 py-3">
        <Link
          href="/dashboard"
          className="font-semibold tracking-tight group-data-[collapsible=icon]:hidden"
        >
          {tCommon('appName')}
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map(({ key, href, icon: Icon }) => {
                const active = pathname === href || pathname.startsWith(`${href}/`)
                return (
                  <SidebarMenuItem key={key}>
                    <SidebarMenuButton
                      render={<Link href={href} />}
                      isActive={active}
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
        <p
          className="text-muted-foreground truncate px-2 text-xs group-data-[collapsible=icon]:hidden"
          title={user.email}
        >
          <span className="sr-only">{tCommon('signedInAs')} </span>
          {user.email}
        </p>
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
