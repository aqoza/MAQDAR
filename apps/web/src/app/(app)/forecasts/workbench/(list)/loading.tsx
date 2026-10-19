import { TableSkeleton } from '@/components/master-data/table-skeleton'
import { PageHeader } from '@/components/page-header'
import { Skeleton } from '@/components/ui/skeleton'

/** The list keeps its forecast banner while data loads; policy detail routes remain separate. */
export default function PolicyWorkbenchLoading() {
  return (
    <div className="space-y-4" aria-busy="true" data-policy-workbench-loading>
      <div aria-hidden="true">
        <PageHeader
          pattern="forecasts"
          title={
            <span className="bg-muted block h-[var(--text-page-title--line-height)] w-64 max-w-full animate-pulse rounded-md motion-reduce:animate-none" />
          }
          description={
            <span className="bg-muted block h-5 w-72 max-w-full animate-pulse rounded-md motion-reduce:animate-none" />
          }
          actions={<Skeleton className="h-9 w-40" />}
        />
        <div className="workspace-toolbar mt-4 grid gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-14" />
          ))}
        </div>
      </div>
      <TableSkeleton rows={8} columns={9} />
    </div>
  )
}
