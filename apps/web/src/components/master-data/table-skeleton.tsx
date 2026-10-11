import { Skeleton } from '@/components/ui/skeleton'

/** Placeholder while a list page loads (Suspense fallback and loading.tsx). */
export function TableSkeleton({ rows = 8, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <div className="flex gap-4 border-b pb-3">
        {Array.from({ length: columns }, (_, index) => (
          <Skeleton key={index} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex gap-4">
          {Array.from({ length: columns }, (_, index) => (
            <Skeleton key={index} className="h-5 flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}
