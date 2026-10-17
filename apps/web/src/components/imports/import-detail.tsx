import { DownloadIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  importLinks,
  type CommitMode,
  type EntityCounts,
  type ImportStatus,
} from '@/lib/imports/client'
import type { EntityName } from '@/lib/imports/contract'
import { CountsTable } from './counts-table'
import { ErrorSummary } from './error-summary'
import { ImportActions } from './import-actions'
import { PartialBanner } from './partial-banner'
import { ImportStatusBadge } from './status-badge'
import {
  appliedRows,
  isFailureCode,
  partialState,
  type ColumnLabelMap,
  type ErrorExample,
  type SummaryFile,
} from './types'

export type DetailBatch = {
  id: string
  status: ImportStatus
  commit_mode: CommitMode | null
  created_at: string
  validated_at: string | null
  finished_at: string | null
  expires_at: string | null
  rows_total: number
  rows_staged: number
  error_count: number
  warning_count: number
  counts: Record<string, EntityCounts>
  failure_code: string | null
  /** A stepped commit without a step for 30 minutes: it can be continued or abandoned. */
  idle: boolean
  /** Who started it, translated. */
  by: string
  /** The request id of a write through the REST API (null for the wizard). */
  request_id?: string | null
}

export type DetailFile = SummaryFile & {
  status: 'staging' | 'sealed' | 'merged'
  source_stored: boolean
  rows_total: number
  rows_new: number
  rows_existing: number
  merged_through_row: number
}

const HINTS = {
  staging: 'stagingHint',
  invalid: 'invalidHint',
  validated: 'validatedHint',
  committing: 'committingHint',
  failed: 'failedHint',
} as const satisfies Partial<Record<ImportStatus, string>>

/**
 * One import: what state it is in and what can be done, a summary, its files (with the stored
 * originals), what the commit did, and the errors with examples and the full report. Rendered on
 * the server; the actions are a client island.
 */
export function ImportDetail({
  batch,
  files,
  examples,
  labels,
}: {
  batch: DetailBatch
  files: readonly DetailFile[]
  examples: readonly ErrorExample[]
  labels: ColumnLabelMap
}) {
  const t = useTranslations('Imports.detail')
  const tImports = useTranslations('Imports')
  const tClient = useTranslations('ImportsClient')
  const format = useFormatter()
  const when = (value: string | null) => (value ? format.dateTime(new Date(value), 'long') : '—')
  const hint = batch.status in HINTS ? HINTS[batch.status as keyof typeof HINTS] : null
  const merged = appliedRows(files)
  // Also after an abandoned or expired stepped commit: the rows it saved stay saved.
  const partial = partialState(batch, merged)
  const hasCounts = Object.keys(batch.counts).length > 0
  const issues = batch.error_count + batch.warning_count

  const summary: { label: string; value: React.ReactNode }[] = [
    { label: t('status'), value: <ImportStatusBadge status={batch.status} /> },
    { label: t('started'), value: when(batch.created_at) },
    { label: t('by'), value: <bdi>{batch.by}</bdi> },
    { label: t('rows'), value: format.number(batch.rows_total) },
    { label: t('validated'), value: when(batch.validated_at) },
    { label: t('finished'), value: when(batch.finished_at) },
  ]
  if (batch.request_id) {
    summary.push({
      label: tImports('requestId'),
      value: (
        <bdi dir="ltr" className="font-mono text-xs break-all select-all">
          {batch.request_id}
        </bdi>
      ),
    })
  }
  if (batch.commit_mode) {
    summary.push({ label: t('mode'), value: t(`modes.${batch.commit_mode}`) })
  }
  if (batch.expires_at && !batch.finished_at) {
    summary.push({ label: t('expires'), value: when(batch.expires_at) })
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{tClient('retention')}</p>
      {hint ? (
        <Alert role="status">
          <AlertDescription>{t(hint)}</AlertDescription>
        </Alert>
      ) : null}
      {batch.failure_code && isFailureCode(batch.failure_code) ? (
        <Alert variant="destructive">
          <AlertTitle>{t('failure')}</AlertTitle>
          <AlertDescription>{tClient(`failure.${batch.failure_code}`)}</AlertDescription>
        </Alert>
      ) : null}
      {partial ? (
        <PartialBanner done={merged} total={batch.rows_total} stopped={partial === 'stopped'} />
      ) : null}
      <ImportActions
        batchId={batch.id}
        status={batch.status}
        idle={batch.idle}
        errorCount={batch.error_count}
        files={files.map((file) => ({
          file_no: file.file_no,
          entity: file.entity,
          rows_total: file.rows_total,
        }))}
        deleteTitle={t('deleteTitle')}
        deleteDescription={t('deleteDescription')}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t('summary')}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {summary.map((entry) => (
              <div key={entry.label} className="flex flex-col gap-0.5">
                <dt className="text-muted-foreground">{entry.label}</dt>
                <dd>{entry.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('files')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('file')}</TableHead>
                <TableHead>{t('data')}</TableHead>
                <TableHead>{t('fileStatus')}</TableHead>
                <TableHead className="text-end">{t('rows')}</TableHead>
                <TableHead className="text-end">{t('newRows')}</TableHead>
                <TableHead className="text-end">{t('existingRows')}</TableHead>
                <TableHead className="text-end">{t('errors')}</TableHead>
                <TableHead className="text-end">{t('warnings')}</TableHead>
                <TableHead>{t('original')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map((file) => (
                <TableRow key={file.file_no}>
                  <TableCell className="max-w-64 truncate">
                    <span className="text-muted-foreground tabular-nums">
                      {format.number(file.file_no)}.
                    </span>{' '}
                    <bdi title={file.name}>{file.name}</bdi>
                  </TableCell>
                  <TableCell>{tClient(`entities.${file.entity as EntityName}`)}</TableCell>
                  <TableCell>{t(`fileStatuses.${file.status}`)}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {format.number(file.rows_total)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {format.number(file.rows_new)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {format.number(file.rows_existing)}
                  </TableCell>
                  <TableCell
                    className={
                      file.error_count > 0
                        ? 'text-destructive text-end tabular-nums'
                        : 'text-end tabular-nums'
                    }
                  >
                    {format.number(file.error_count)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {format.number(file.warning_count)}
                  </TableCell>
                  <TableCell>
                    {file.source_stored ? (
                      <a
                        href={importLinks.original(batch.id, file.file_no)}
                        className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                      >
                        <DownloadIcon className="size-3.5" aria-hidden="true" />
                        {t('download')}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">{t('notStored')}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {hasCounts ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('result')}</CardTitle>
          </CardHeader>
          <CardContent>
            <CountsTable counts={batch.counts} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('issues')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {issues > 0 ? (
            <div>
              <a
                href={importLinks.errorReport(batch.id)}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                <DownloadIcon aria-hidden="true" />
                {tClient('check.downloadReport')}
              </a>
            </div>
          ) : null}
          {issues > 0 ? (
            <ErrorSummary files={files} examples={examples} labels={labels} />
          ) : (
            <p className="text-muted-foreground text-sm">{t('noIssues')}</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
