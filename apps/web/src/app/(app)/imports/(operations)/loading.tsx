import { TableSkeleton } from '@/components/master-data/table-skeleton'
import { Skeleton } from '@/components/ui/skeleton'

/** Plain fallback for the wizard and individual import pages. History has its own banner. */
export default function ImportsLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <TableSkeleton rows={8} columns={6} />
    </div>
  )
}
