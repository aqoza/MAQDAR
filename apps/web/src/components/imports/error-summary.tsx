import { useFormatter, useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { errorLevel } from '@/lib/imports/contract'
import type { Messages } from '@/i18n/messages'
import type { ColumnLabelMap, ErrorExample, SummaryFile } from './types'

type ImportErrorKey = keyof Messages['ImportErrors']

/** Details stored per file (the database keeps counts complete beyond that). */
const STORED_DETAILS_PER_FILE = 10_000

type Group = {
  code: string
  column: string
  count: number
  level: 'error' | 'warning'
  examples: ErrorExample[]
}

function groupsOf(file: SummaryFile, examples: readonly ErrorExample[]): Group[] {
  const groups: Group[] = []
  for (const [code, perColumn] of Object.entries(file.error_counts)) {
    for (const [column, count] of Object.entries(perColumn)) {
      groups.push({
        code,
        column,
        count,
        level: errorLevel(code) ?? 'error',
        examples: examples.filter(
          (example) =>
            example.file_no === file.file_no &&
            example.code === code &&
            example.column_name === column,
        ),
      })
    }
  }
  return groups.sort(
    (a, b) =>
      Number(a.level === 'warning') - Number(b.level === 'warning') ||
      b.count - a.count ||
      a.code.localeCompare(b.code),
  )
}

/**
 * Errors and warnings by file, code and column with counts and up to five examples each (row
 * number and the offending value as stored, at most 200 characters). Works in server and client
 * trees; messages come from the ImportErrors namespace.
 */
export function ErrorSummary({
  files,
  examples,
  labels,
}: {
  files: readonly SummaryFile[]
  examples: readonly ErrorExample[]
  labels: ColumnLabelMap
}) {
  const t = useTranslations('ImportsClient')
  const tErrors = useTranslations('ImportErrors')
  const format = useFormatter()
  const withIssues = files.filter((file) => file.error_count + file.warning_count > 0)
  if (withIssues.length === 0) {
    return <p className="text-muted-foreground text-sm">{t('summary.none')}</p>
  }

  const message = (code: string) =>
    tErrors.has(code as ImportErrorKey) ? tErrors(code as ImportErrorKey) : code

  return (
    <div className="flex flex-col gap-6">
      {withIssues.map((file) => {
        const groups = groupsOf(file, examples)
        const capped = file.errors_stored >= STORED_DETAILS_PER_FILE
        return (
          <section key={file.file_no} className="flex flex-col gap-2">
            <h3 className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium">
              <bdi>{t('summary.file', { fileNo: file.file_no, name: file.name })}</bdi>
              <span className="text-muted-foreground font-normal">
                {t(`entities.${file.entity}`)}
              </span>
            </h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('summary.problem')}</TableHead>
                  <TableHead>{t('summary.column')}</TableHead>
                  <TableHead className="text-end">{t('summary.rows')}</TableHead>
                  <TableHead>{t('summary.examples')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => {
                  const wholeFile =
                    group.column === '' &&
                    group.examples.length > 0 &&
                    group.examples.every((example) => example.row_no === 0)
                  return (
                    <TableRow key={`${group.code}:${group.column}`} className="align-top">
                      <TableCell className="min-w-56 whitespace-normal">
                        <div className="flex flex-col items-start gap-1">
                          <Badge variant={group.level === 'error' ? 'destructive' : 'outline'}>
                            {group.level === 'error' ? t('summary.error') : t('summary.warning')}
                          </Badge>
                          <span>{message(group.code)}</span>
                          <code className="text-muted-foreground text-xs" dir="ltr">
                            {group.code}
                          </code>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        {group.column === '' ? (
                          <span className="text-muted-foreground">
                            {wholeFile ? t('summary.wholeFile') : t('summary.wholeRow')}
                          </span>
                        ) : (
                          <div className="flex flex-col items-start">
                            <span>{labels[file.entity]?.[group.column] ?? group.column}</span>
                            <code className="text-muted-foreground text-xs" dir="ltr">
                              {group.column}
                            </code>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {format.number(group.count)}
                      </TableCell>
                      <TableCell className="min-w-48 whitespace-normal">
                        <ul className="flex flex-col gap-0.5 text-xs">
                          {group.examples.map((example) => (
                            <li key={`${example.row_no}:${example.value ?? ''}`}>
                              <span className="text-muted-foreground">
                                {example.row_no === 0
                                  ? t('summary.wholeFile')
                                  : t('summary.row', { row: example.row_no })}
                              </span>
                              {example.value === null ? null : (
                                <>
                                  {': '}
                                  {example.value === '' ? (
                                    <span className="text-muted-foreground italic">
                                      {t('summary.empty')}
                                    </span>
                                  ) : (
                                    <bdi className="font-mono break-all">{example.value}</bdi>
                                  )}
                                </>
                              )}
                            </li>
                          ))}
                        </ul>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            {capped ? (
              <p className="text-muted-foreground text-xs">
                {t('summary.capped', { count: STORED_DETAILS_PER_FILE })}
              </p>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}
