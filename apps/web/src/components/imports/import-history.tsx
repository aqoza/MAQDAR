import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { EntityCounts, ImportStatus } from '@/lib/imports/client'
import type { EntityName } from '@/lib/imports/contract'
import { ImportStatusBadge } from './status-badge'
import { countTotals, hasCommitResult } from './types'

export type HistoryRow = {
  id: string
  status: ImportStatus
  created_at: string
  /** Distinct entities of its files, in load order. */
  entities: EntityName[]
  rows_total: number
  error_count: number
  warning_count: number
  counts: Record<string, EntityCounts>
  /** Who started it, already translated (you, another member, an e-mail, or the API). */
  by: string
}

const SHOWN_ENTITIES = 3

/** The import history table (server-rendered; the page owns paging and filters). */
export function ImportHistory({ rows }: { rows: readonly HistoryRow[] }) {
  const t = useTranslations('Imports')
  const tClient = useTranslations('ImportsClient')
  const format = useFormatter()

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('columns.started')}</TableHead>
          <TableHead>{t('columns.data')}</TableHead>
          <TableHead className="text-end">{t('columns.rows')}</TableHead>
          <TableHead>{t('columns.status')}</TableHead>
          <TableHead>{t('columns.result')}</TableHead>
          <TableHead className="text-end">{t('columns.issues')}</TableHead>
          <TableHead>{t('columns.by')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const sum = countTotals(row.counts)
          const shown = row.entities.slice(0, SHOWN_ENTITIES)
          const more = row.entities.length - shown.length
          // A stepped commit that was abandoned or expired keeps the rows it saved: show them.
          const committed = hasCommitResult(row.status, row.counts)
          return (
            <TableRow key={row.id}>
              <TableCell>
                <Link
                  href={`/imports/${row.id}`}
                  prefetch={false}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {format.dateTime(new Date(row.created_at), 'long')}
                </Link>
              </TableCell>
              <TableCell className="whitespace-normal">
                {format.list(shown.map((entity) => tClient(`entities.${entity}`)))}
                {more > 0 ? (
                  <span className="text-muted-foreground"> {t('moreFiles', { count: more })}</span>
                ) : null}
              </TableCell>
              <TableCell className="text-end tabular-nums">
                {format.number(row.rows_total)}
              </TableCell>
              <TableCell>
                <ImportStatusBadge status={row.status} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {committed
                  ? sum.deleted > 0
                    ? t('resultWithDeleted', sum)
                    : t('resultSummary', { inserted: sum.inserted, updated: sum.updated })
                  : '—'}
              </TableCell>
              <TableCell className="text-end tabular-nums">
                <span className={row.error_count > 0 ? 'text-destructive' : undefined}>
                  {t('issueCounts', { errors: row.error_count, warnings: row.warning_count })}
                </span>
              </TableCell>
              <TableCell className="max-w-48 truncate" title={row.by}>
                <bdi>{row.by}</bdi>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
