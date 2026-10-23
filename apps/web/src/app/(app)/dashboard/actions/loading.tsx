import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { DashboardNav } from '@/components/dashboard-nav'
import { Skeleton } from '@/components/ui/skeleton'

export default async function Loading() {
  const t = await getTranslations('PlannerActions')
  return (
    <div className="min-w-0 space-y-3" aria-busy="true" data-section-loading="replenishment">
      <PageHeader
        pattern="replenishment"
        title={t('title')}
        description={t('subtitle')}
        navigation={<DashboardNav current="actions" />}
      />
      <p role="status" className="text-xs text-muted-foreground">
        {t('loading')}
      </p>
      <div aria-hidden="true" className="grid gap-3">
        <Skeleton className="h-14 motion-reduce:animate-none" />
        <Skeleton className="h-11 motion-reduce:animate-none" />
        <Skeleton className="h-80 motion-reduce:animate-none" />
      </div>
    </div>
  )
}
