import { useFormatter, useTranslations } from 'next-intl'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { EntityCounts } from '@/lib/imports/client'
import { compareLoadOrder, isEntityName, type EntityName } from '@/lib/imports/contract'
import { EXTRA_COUNT_COLUMNS, countColumns } from './types'

/**
 * What a commit did per entity, in load order. Location parents changed in the second pass and
 * other suppliers' preferred flags cleared get a column of their own when a commit reports them.
 * Works in server and client trees.
 */
export function CountsTable({ counts }: { counts: Record<string, EntityCounts> | undefined }) {
  const t = useTranslations('ImportsClient')
  const format = useFormatter()
  const entities = Object.keys(counts ?? {})
    .filter((entity): entity is EntityName => isEntityName(entity))
    .sort(compareLoadOrder)
  if (entities.length === 0) return null
  const columns = countColumns(counts)

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('commit.counts.entity')}</TableHead>
          {columns.map((column) => (
            <TableHead key={column} className="text-end">
              {t(`commit.counts.${column}`)}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {entities.map((entity) => (
          <TableRow key={entity}>
            <TableCell className="font-medium">{t(`entities.${entity}`)}</TableCell>
            {columns.map((column) => {
              const value = counts?.[entity]?.[column]
              return (
                <TableCell key={column} className="text-end tabular-nums">
                  {value === undefined && isExtra(column) ? '—' : format.number(value ?? 0)}
                </TableCell>
              )
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/** The extra columns apply to one entity each; the others show a dash there. */
function isExtra(column: string): boolean {
  return (EXTRA_COUNT_COLUMNS as readonly string[]).includes(column)
}
