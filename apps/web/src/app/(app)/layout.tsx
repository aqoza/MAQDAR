import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { ActiveOrganizationProvider } from '@/components/active-organization'
import { AppSidebar } from '@/components/app-sidebar'
import { PendingInvitationsBanner } from '@/components/pending-invitations-banner'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { getActiveContext } from '@/lib/organizations/context'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const context = await getActiveContext()
  if (!context) redirect('/login')
  // No memberships, a token issued before the hook, or a claim for an organization the user left:
  // the hub lets them pick (or create) one, which mints a fresh token.
  if (!context.active) redirect('/organizations')

  const t = await getTranslations('Common')
  const pendingInvitationCount = context.invitations.length

  return (
    <SidebarProvider className="app-shell">
      <AppSidebar
        user={{ email: context.email ?? '' }}
        organizations={context.organizations}
        active={context.active}
        role={context.role}
        pendingInvitationCount={pendingInvitationCount}
      />
      {/* min-w-0 lets wide tables scroll inside their container instead of widening the page. */}
      <SidebarInset className="min-w-0">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b bg-background px-4">
          <SidebarTrigger aria-label={t('toggleSidebar')} />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-muted-foreground text-sm">{t('tagline')}</span>
        </header>
        <div data-app-content className="flex flex-1 flex-col gap-4 p-4 text-sm">
          {pendingInvitationCount > 0 ? (
            <PendingInvitationsBanner count={pendingInvitationCount} />
          ) : null}
          <ActiveOrganizationProvider organizationId={context.active.id}>
            {children}
          </ActiveOrganizationProvider>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
