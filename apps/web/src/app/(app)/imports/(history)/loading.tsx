import { TableSkeleton } from '@/components/master-data/table-skeleton'
import { PageHeader } from '@/components/page-header'
import { Skeleton } from '@/components/ui/skeleton'

/** Match history's server-rendered header without changing the wizard/detail fallbacks. */
export default function ImportHistoryLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <div aria-hidden="true">
        <PageHeader
          pattern="imports"
          title={
            <span className="bg-muted block h-[var(--text-page-title--line-height)] w-48 max-w-full animate-pulse rounded-md" />
          }
          description={
            <span className="bg-muted block h-5 w-80 max-w-full animate-pulse rounded-md" />
          }
          actions={<Skeleton className="h-8 w-28" />}
        />
      </div>
      <TableSkeleton rows={8} columns={6} />
    </div>
  )
}
