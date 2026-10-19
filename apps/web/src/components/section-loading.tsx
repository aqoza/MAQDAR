import { getTranslations } from 'next-intl/server'
import { TableSkeleton } from '@/components/master-data/table-skeleton'
import { PageHeader } from '@/components/page-header'
import type { PageHeaderPattern } from '@/components/page-header-art'
import { Skeleton } from '@/components/ui/skeleton'

/** Reuse inside existing loading boundaries; ancestor streaming can change late 404 statuses. */
export async function SectionLoading({ pattern }: { pattern: PageHeaderPattern }) {
  const t = await getTranslations('Common')
  return (
    <div className="min-w-0 space-y-4" aria-busy="true" data-section-loading={pattern}>
      <div aria-hidden="true">
        <PageHeader
          pattern={pattern}
          title={
            <span className="bg-muted block h-[var(--text-page-title--line-height)] w-56 max-w-full animate-pulse rounded-md motion-reduce:animate-none" />
          }
          description={
            <span className="bg-muted block h-5 w-72 max-w-full animate-pulse rounded-md motion-reduce:animate-none" />
          }
          actions={
            <Skeleton className="h-9 w-32 max-w-full motion-reduce:animate-none max-md:h-11" />
          }
        />
        <div className="workspace-panel mt-4 grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-14 motion-reduce:animate-none" />
          <Skeleton className="h-14 motion-reduce:animate-none" />
        </div>
        <div className="mt-4">
          <TableSkeleton />
        </div>
      </div>
      <p className="sr-only" role="status">
        {t('loading')}
      </p>
    </div>
  )
}
