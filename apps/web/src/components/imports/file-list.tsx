'use client'

import { XIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { entitiesInLoadOrder, isEntityName, type EntityName } from '@/lib/imports/contract'
import type { PreviousFile } from './types'
import type { FileFailure, WizardFile } from './wizard-state'

const PROBLEM_CODES = [
  'unsupported_type',
  'empty_file',
  'too_large',
  'too_many_rows',
  'too_many_columns',
  'no_header',
  'unreadable',
  'record_too_long',
  'internal',
] as const

type ProblemCode = (typeof PROBLEM_CODES)[number]

/** The translated reason a file cannot be imported (a parse failure or an inspection problem). */
export function useFileProblem() {
  const t = useTranslations('ImportsClient.problems')
  return (problem: FileFailure): string => {
    const code: ProblemCode = (PROBLEM_CODES as readonly string[]).includes(problem.code)
      ? (problem.code as ProblemCode)
      : 'internal'
    if (code === 'record_too_long') return t('record_too_long', { row: problem.detail?.row ?? 0 })
    return t(code)
  }
}

export type FileListProps = {
  files: readonly WizardFile[]
  previousBySha: ReadonlyMap<string, PreviousFile>
  /** SHA-256 of files chosen more than once in this import. */
  repeatedShas: ReadonlySet<string>
  entityTwice: readonly EntityName[]
  disabled?: boolean
  onEntityChange: (id: string, entity: EntityName | null) => void
  onRemove: (id: string) => void
}

/** The chosen files with their entity, state and duplicate warnings. */
export function ImportFileList({
  files,
  previousBySha,
  repeatedShas,
  entityTwice,
  disabled,
  onEntityChange,
  onRemove,
}: FileListProps) {
  const t = useTranslations('ImportsClient')
  const format = useFormatter()
  const problemText = useFileProblem()
  const entities = entitiesInLoadOrder()

  if (files.length === 0) {
    return <p className="text-muted-foreground text-sm">{t('files.empty')}</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('files.name')}</TableHead>
          <TableHead>{t('files.entity')}</TableHead>
          <TableHead className="text-end">{t('files.size')}</TableHead>
          <TableHead>{t('files.state')}</TableHead>
          <TableHead aria-hidden="true" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {files.map((file) => {
          const problem =
            file.failure ?? (file.inspect?.problems[0] ? file.inspect.problems[0] : null)
          const previous = file.inspect ? previousBySha.get(file.inspect.sha256) : undefined
          const repeated = file.inspect ? repeatedShas.has(file.inspect.sha256) : false
          const selectId = `import-entity-${file.id}`
          return (
            <TableRow key={file.id} className="align-top">
              <TableCell className="max-w-72 whitespace-normal">
                <bdi className="font-medium break-all">{file.file.name}</bdi>
                {previous ? (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                    {t('files.duplicate', {
                      date: format.dateTime(new Date(previous.created_at), 'short'),
                    })}{' '}
                    {/* A new tab: the chosen files and mappings stay in this one. */}
                    <a
                      href={`/imports/${previous.batch_id}`}
                      target="_blank"
                      rel="noopener"
                      className="underline underline-offset-4"
                    >
                      {t('files.viewEarlier')}
                    </a>
                  </p>
                ) : null}
                {repeated ? (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                    {t('files.duplicateInBatch')}
                  </p>
                ) : null}
              </TableCell>
              <TableCell>
                <label htmlFor={selectId} className="sr-only">
                  {t('files.entity')}
                </label>
                <NativeSelect
                  id={selectId}
                  value={file.entity ?? ''}
                  disabled={disabled}
                  aria-invalid={
                    file.entity === null || entityTwice.includes(file.entity) ? true : undefined
                  }
                  onChange={(event) => {
                    const value = event.currentTarget.value
                    onEntityChange(file.id, isEntityName(value) ? value : null)
                  }}
                >
                  <NativeSelectOption value="">{t('files.pickEntity')}</NativeSelectOption>
                  {entities.map((entity) => (
                    <NativeSelectOption key={entity.name} value={entity.name}>
                      {t(`entities.${entity.name}`)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                {file.entity && entityTwice.includes(file.entity) ? (
                  <p className="text-destructive mt-1 text-xs">
                    {t('files.entityTwice', { entity: t(`entities.${file.entity}`) })}
                  </p>
                ) : null}
              </TableCell>
              <TableCell className="text-end tabular-nums">
                {t('files.sizeValue', { size: Math.max(1, Math.round(file.file.size / 1024)) })}
              </TableCell>
              <TableCell className="whitespace-normal">
                {file.inspecting ? (
                  <span className="text-muted-foreground">{t('files.reading')}</span>
                ) : problem ? (
                  <span className="text-destructive">{problemText(problem)}</span>
                ) : (
                  <span className="text-muted-foreground">
                    {file.inspect?.rowCount != null
                      ? t('format.rowCount', { count: file.inspect.rowCount })
                      : t('files.ready')}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={disabled}
                  aria-label={t('files.remove', { name: file.file.name })}
                  title={t('files.remove', { name: file.file.name })}
                  onClick={() => onRemove(file.id)}
                >
                  <XIcon aria-hidden="true" />
                </Button>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
