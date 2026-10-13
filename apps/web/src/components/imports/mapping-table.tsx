'use client'

import { useFormatter, useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getEntity, type ContractColumn, type EntityName } from '@/lib/imports/contract'
import type { ColumnMapping, MappingIssue } from '@/lib/imports/mapping'

export type MappingTableProps = {
  entity: EntityName
  header: readonly string[]
  mapping: ColumnMapping
  issues: readonly MappingIssue[]
  /** Display label per contract column. */
  labels: Readonly<Record<string, string>>
  onChange: (column: string, index: number | null) => void
  /** Prefix for element ids (one table per file). */
  idPrefix: string
}

/**
 * One row per contract column: its label and name, key / required-for-new / group badges, the
 * file column that feeds it, and what happens when it is not imported ("left unchanged" on
 * existing rows, the default on new ones). Mapping errors show on the row they concern.
 */
export function MappingTable({
  entity,
  header,
  mapping,
  issues,
  labels,
  onChange,
  idPrefix,
}: MappingTableProps) {
  const t = useTranslations('ImportsClient.map')
  const format = useFormatter()
  const contract = getEntity(entity)
  const label = (column: string) => labels[column] ?? column
  const list = (columns: readonly string[]) => format.list(columns.map(label))

  const headerLabel = (index: number) => {
    const text = header[index]?.trim() ?? ''
    return text === '' ? t('blankHeader', { index: index + 1 }) : text
  }

  type RowIssue = { text: string; level: 'error' | 'warning' }
  const rowIssues = (column: string): RowIssue[] =>
    issues.flatMap((issue): RowIssue[] => {
      switch (issue.code) {
        case 'key_unmapped':
          return issue.column === column
            ? [{ level: 'error', text: t('issues.key_unmapped', { column: label(column) }) }]
            : []
        case 'group_incomplete':
          return issue.missing.includes(column)
            ? [
                {
                  level: 'error',
                  text: t('issues.group_incomplete', {
                    missing: list(issue.missing),
                    group: list(issue.group),
                  }),
                },
              ]
            : []
        case 'duplicate_source':
          return issue.columns[0] === column
            ? [
                {
                  level: 'error',
                  text: t('issues.duplicate_source', { columns: list(issue.columns) }),
                },
              ]
            : []
        case 'unknown_source':
          return issue.column === column
            ? [{ level: 'error', text: t('issues.unknown_source', { column: label(column) }) }]
            : []
        case 'required_for_new_unmapped':
          return issue.column === column
            ? [
                {
                  level: 'warning',
                  text: t('issues.required_for_new_unmapped', { column: label(column) }),
                },
              ]
            : []
        default:
          return []
      }
    })

  const defaultText = (column: ContractColumn) => {
    if (column.default === null) return null
    return column.default === '' ? t('emptyDefault') : column.default
  }

  const fileIssues = issues.flatMap((issue) => {
    if (issue.code === 'value_column_required') return [t('issues.value_column_required')]
    if (issue.code === 'too_many_columns') {
      return [t('issues.too_many_columns', { count: issue.count, max: issue.max })]
    }
    return []
  })
  const ignored = issues.flatMap((issue) =>
    issue.code === 'unmapped_header' && issue.header.trim() !== '' ? [issue.header] : [],
  )

  return (
    <div className="flex flex-col gap-3">
      {fileIssues.length > 0 ? (
        <ul className="text-destructive flex flex-col gap-1 text-sm" role="alert">
          {fileIssues.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('column')}</TableHead>
            <TableHead>{t('source')}</TableHead>
            <TableHead>{t('notes')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contract.columns.map((column) => {
            const entry = mapping[column.name]
            const selectId = `${idPrefix}-${column.name}`
            const problems = rowIssues(column.name)
            const group = contract.column_groups.find((candidate) =>
              candidate.includes(column.name),
            )
            const fallback = defaultText(column)
            return (
              <TableRow key={column.name} className="align-top">
                <TableCell className="min-w-48 whitespace-normal">
                  <label htmlFor={selectId} className="flex flex-col items-start gap-1">
                    <span className="font-medium">{label(column.name)}</span>
                    <code className="text-muted-foreground text-xs" dir="ltr">
                      {column.name}
                    </code>
                  </label>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {column.natural_key ? <Badge>{t('key')}</Badge> : null}
                    {column.required_for_new ? (
                      <Badge variant="secondary">{t('requiredForNew')}</Badge>
                    ) : null}
                    {group ? (
                      <Badge variant="outline" className="h-auto whitespace-normal">
                        {t('together', {
                          columns: list(group.filter((name) => name !== column.name)),
                        })}
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="min-w-48">
                  <NativeSelect
                    id={selectId}
                    value={entry ? String(entry.index) : ''}
                    aria-invalid={
                      problems.some((problem) => problem.level === 'error') ? true : undefined
                    }
                    onChange={(event) => {
                      const value = event.currentTarget.value
                      onChange(column.name, value === '' ? null : Number(value))
                    }}
                    className="w-full max-w-64"
                  >
                    <NativeSelectOption value="">{t('notMapped')}</NativeSelectOption>
                    {header.map((_, index) => (
                      <NativeSelectOption key={index} value={String(index)}>
                        {headerLabel(index)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </TableCell>
                <TableCell className="min-w-56 text-sm whitespace-normal">
                  {entry ? (
                    <span className="text-muted-foreground">{t(`matchedBy.${entry.source}`)}</span>
                  ) : column.natural_key || column.required_for_new ? null : (
                    <span className="text-muted-foreground">
                      {fallback === null
                        ? t('leftUnchanged')
                        : t('leftUnchangedDefault', { value: fallback })}
                    </span>
                  )}
                  {problems.map((problem) => (
                    <p
                      key={problem.text}
                      className={
                        problem.level === 'error'
                          ? 'text-destructive'
                          : 'text-amber-700 dark:text-amber-400'
                      }
                    >
                      {problem.text}
                    </p>
                  ))}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {ignored.length > 0 ? (
        <p className="text-muted-foreground text-sm">
          {t('ignoredHeaders', { headers: format.list(ignored) })}
        </p>
      ) : null}
    </div>
  )
}
