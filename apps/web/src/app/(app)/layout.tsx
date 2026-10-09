import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { AppSidebar } from '@/components/app-sidebar'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { createClient } from '@/lib/supabase/server'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (!claims) redirect('/login')

  const t = await getTranslations('Common')
  const email = typeof claims.email === 'string' ? claims.email : ''

  return (
    <SidebarProvider>
      <AppSidebar user={{ email }} />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger aria-label={t('toggleSidebar')} />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-muted-foreground text-sm">{t('tagline')}</span>
        </header>
        <div className="flex flex-1 flex-col gap-6 p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
