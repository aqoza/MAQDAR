import { PageHeader } from '@/components/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import styles from './settings-workspace.module.css'

/** Keep the illustrated shell and workspace geometry while Settings renders on the server. */
export default function SettingsLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" data-settings-loading>
      <div aria-hidden="true">
        <PageHeader
          pattern="settings"
          title={<span className="bg-muted block h-7 w-40 animate-pulse rounded-md" />}
          description={
            <span className="bg-muted block h-5 w-64 max-w-full animate-pulse rounded-md" />
          }
        />
      </div>
      <div className={styles.workspace} aria-hidden="true">
        <div className={`${styles.menu} ${styles.loadingMenu}`}>
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="flex flex-col gap-5 rounded-lg border bg-card p-5">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-64 max-w-full" />
          <div className="grid gap-5 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-14" />
            ))}
          </div>
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    </div>
  )
}
