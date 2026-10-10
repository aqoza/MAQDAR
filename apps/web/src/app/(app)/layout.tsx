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
    <SidebarProvider>
      <AppSidebar
        user={{ email: context.email ?? '' }}
        organizations={context.organizations}
        active={context.active}
        role={context.role}
        pendingInvitationCount={pendingInvitationCount}
      />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger aria-label={t('toggleSidebar')} />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-muted-foreground text-sm">{t('tagline')}</span>
        </header>
        <div className="flex flex-1 flex-col gap-6 p-6">
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
