'use client'
import Link from 'next/link'
import { Truck, LogOut } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from '@/components/ui/sidebar'
import { useDirection } from '@/components/ui/direction'
import { ZeeSpareMark } from '@/components/zeespare-mark'
import { signOut } from '@/lib/auth/actions'
export function SupplierPortalSidebar({ email }: { email: string }) {
  const t = useTranslations('SupplierPortal')
  const common = useTranslations('Common')
  const dir = useDirection()
  const sidebar = useSidebar()
  const path = usePathname()
  return (
    <Sidebar collapsible="icon" side={dir === 'rtl' ? 'right' : 'left'} dir={dir}>
      <SidebarHeader className="app-sidebar-header">
        <Link
          className="app-brand flex min-h-11 items-center gap-2 px-2 font-semibold group-data-[collapsible=icon]:hidden"
          href="/supplier-portal"
        >
          <ZeeSpareMark className="size-6 text-primary" />
          <span dir="ltr">{common('appName')}</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                className="max-md:min-h-11"
                isActive={path.startsWith('/supplier-portal')}
                render={
                  <Link href="/supplier-portal" onClick={() => sidebar.setOpenMobile(false)} />
                }
                tooltip={t('title')}
              >
                <Truck />
                <span>{t('title')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <p className="truncate px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          {email}
        </p>
        <form action={signOut}>
          <button className="flex min-h-11 items-center gap-2 px-2 text-sm">
            <LogOut className="size-4" />
            <span className="group-data-[collapsible=icon]:hidden">{common('signOut')}</span>
          </button>
        </form>
      </SidebarFooter>
    </Sidebar>
  )
}
