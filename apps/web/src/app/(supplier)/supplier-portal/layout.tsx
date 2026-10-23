import { headers } from 'next/headers'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { getSupplierPortals } from '@/lib/supplier-portal-context'
import { portalGrantFromPath } from '@/lib/supplier-portal'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { AppSidebar } from '@/components/app-sidebar'
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar'
import { getSessionClaims } from '@/lib/auth/session'
export default async function SupplierLayout({ children }: { children: React.ReactNode }) {
  const claims = await getSessionClaims()
  if (!claims) redirect('/login')
  const grantId = portalGrantFromPath((await headers()).get('x-zeespare-pathname'))
  const grant = grantId ? (await getSupplierPortals()).find((g) => g.id === grantId) : null
  const t = await getTranslations('SupplierPortal')
  const common = await getTranslations('Common')
  return (
    <SidebarProvider className="app-shell">
      <AppSidebar portal user={{ email: claims.email ?? '' }} />
      <SidebarInset className="min-w-0">
        <header className="flex min-h-11 flex-wrap items-center gap-2 border-b bg-background px-4">
          <SidebarTrigger aria-label={common('toggleSidebar')} />
          <span className="text-sm text-muted-foreground">{t('title')}</span>
          {grant?.arabic_enabled && (
            <div className="ms-auto">
              <LocaleSwitcher portalGrantId={grant.id} />
            </div>
          )}
        </header>
        <main data-app-content className="min-w-0 flex-1 space-y-4 p-4 text-sm">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
