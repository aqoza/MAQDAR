import { CircleAlertIcon, CircleCheckIcon, LoaderCircleIcon } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

export type ProgressItem = {
  key: string
  title: string
  subtitle?: string
  /** What is happening (translated). */
  phase: string
  state: 'waiting' | 'running' | 'done' | 'failed'
  /** 0..1, or null when unknown. */
  fraction: number | null
  /** Rows done of total, translated. */
  detail?: string
  /** A secondary line (the original file's upload), translated. */
  note?: string
  noteTone?: 'muted' | 'warning'
}

/** Per-file progress while files are read, checked and committed. Works in any tree. */
export function ProgressPanel({ items, label }: { items: readonly ProgressItem[]; label: string }) {
  return (
    <ul className="flex flex-col gap-3" aria-label={label}>
      {items.map((item) => (
        <li key={item.key} className="flex flex-col gap-1.5 rounded-lg border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {item.state === 'done' ? (
                <CircleCheckIcon className="size-4 shrink-0 text-emerald-600" aria-hidden="true" />
              ) : item.state === 'failed' ? (
                <CircleAlertIcon className="text-destructive size-4 shrink-0" aria-hidden="true" />
              ) : item.state === 'running' ? (
                <LoaderCircleIcon
                  className="text-muted-foreground size-4 shrink-0 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <span className="size-4 shrink-0" aria-hidden="true" />
              )}
              <bdi className="truncate text-sm font-medium" title={item.title}>
                {item.title}
              </bdi>
              {item.subtitle ? (
                <span className="text-muted-foreground text-xs">{item.subtitle}</span>
              ) : null}
            </div>
            {/* Not a live region: it changes with every chunk; the wizard announces phases. */}
            <span className="text-muted-foreground text-xs">
              {item.phase}
              {item.detail ? ` · ${item.detail}` : null}
            </span>
          </div>
          <Progress
            value={item.fraction === null ? null : Math.round(item.fraction * 1000) / 10}
            aria-label={item.title}
          />
          {item.note ? (
            <p
              className={cn(
                'text-xs',
                item.noteTone === 'warning'
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-muted-foreground',
              )}
            >
              {item.note}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
