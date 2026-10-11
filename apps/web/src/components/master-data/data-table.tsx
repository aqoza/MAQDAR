import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from 'lucide-react'
import Link from 'next/link'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EMPTY, displayName, formatDateOnly, formatDecimal, formatMoney } from '@/lib/format'
import { sortHref, type ListParams } from '@/lib/master-data/list-params'
import { getEntityTranslator, type LooseTranslator } from '@/lib/master-data/messages'
import type { CellKind, ColumnDef, EntityDefinition, EntityRow } from '@/lib/master-data/types'
import { cn } from '@/lib/utils'

const NUMERIC: ReadonlySet<CellKind> = new Set(['money', 'quantity', 'integer', 'rate'])

type Formatter = Awaited<ReturnType<typeof getFormatter>>

type CellContext = {
  definition: EntityDefinition
  t: LooseTranslator
  format: Formatter
  locale: string
  yes: string
  no: string
}

/** An option label from `<namespace>.options.<field>.<value>`, or the raw value. */
function optionLabel(t: LooseTranslator, field: string, value: string): string {
  const key = `options.${field}.${value}`
  return t.has(key) ? t(key) : value
}

function textOf(value: unknown): string {
  return value === null || value === undefined || value === '' ? EMPTY : String(value)
}

function weekdayNames(format: Formatter, days: unknown): string {
  if (!Array.isArray(days) || days.length === 0) return EMPTY
  // 2024-01-01 was a Monday, so ISO weekday d falls on 2024-01-0d.
  return days
    .map((day) =>
      format.dateTime(new Date(Date.UTC(2024, 0, Number(day))), {
        weekday: 'short',
        timeZone: 'UTC',
      }),
    )
    .join(', ')
}

function Cell({ column, row, ctx }: { column: ColumnDef; row: EntityRow; ctx: CellContext }) {
  const field = column.field ?? column.key
  const value = row[field]
  switch (column.kind) {
    case 'code': {
      const code = (
        <bdi dir="ltr" className="font-mono text-xs">
          {textOf(value)}
        </bdi>
      )
      return column.link ? (
        <Link
          href={`${ctx.definition.basePath}/${String(row.id)}`}
          prefetch={false}
          className="font-medium underline-offset-4 hover:underline"
        >
          {code}
        </Link>
      ) : (
        code
      )
    }
    case 'name': {
      const name = displayName(row as { name_en?: string; name_ar?: string | null }, ctx.locale)
      const primary = (
        <span lang={name.primaryLang} dir={name.primaryLang === 'ar' ? 'rtl' : undefined}>
          {name.primary}
        </span>
      )
      return (
        <div className="flex min-w-40 flex-col items-start whitespace-normal">
          {column.link ? (
            // Entities without a code (holiday overrides) link their name instead.
            <Link
              href={`${ctx.definition.basePath}/${String(row.id)}`}
              prefetch={false}
              className="font-medium underline-offset-4 hover:underline"
            >
              {primary}
            </Link>
          ) : (
            primary
          )}
          {name.secondary ? (
            <span
              lang={name.secondaryLang}
              dir={name.secondaryLang === 'ar' ? 'rtl' : undefined}
              className="text-muted-foreground text-xs"
            >
              {name.secondary}
            </span>
          ) : null}
        </div>
      )
    }
    case 'badge':
      return value === null || value === undefined || value === '' ? (
        EMPTY
      ) : (
        <Badge variant="outline">{optionLabel(ctx.t, field, String(value))}</Badge>
      )
    case 'boolean': {
      const key = `options.${field}.${String(value === true)}`
      return ctx.t.has(key) ? ctx.t(key) : value === true ? ctx.yes : ctx.no
    }
    case 'money': {
      const currency = column.currencyField ? row[column.currencyField] : null
      return formatMoney(
        ctx.format,
        typeof value === 'number' ? value : null,
        typeof currency === 'string' ? currency : null,
      )
    }
    case 'quantity':
      return formatDecimal(ctx.format, typeof value === 'number' ? value : null, 3)
    case 'rate':
      return formatDecimal(ctx.format, typeof value === 'number' ? value : null, 10)
    case 'integer':
      return typeof value === 'number' ? ctx.format.number(value) : EMPTY
    case 'date':
      return formatDateOnly(ctx.format, typeof value === 'string' ? value : null)
    case 'weekdays':
      return weekdayNames(ctx.format, value)
    case 'ref': {
      const embedded = value as { code?: string; name_en?: string } | null | undefined
      return embedded?.code ? (
        <bdi dir="ltr" className="font-mono text-xs" title={embedded.name_en}>
          {embedded.code}
        </bdi>
      ) : (
        EMPTY
      )
    }
    case 'text':
    default:
      return textOf(value)
  }
}

/**
 * The rows of one list page. Sortable headers are links (with aria-sort on the sorted column);
 * numbers align to the end, codes are isolated left-to-right and Arabic names are marked up as
 * Arabic, so mixed-direction rows read correctly in both interface languages.
 */
export async function DataTable({
  definition,
  rows,
  params,
}: {
  definition: EntityDefinition
  rows: EntityRow[]
  params: ListParams
}) {
  const [t, tList, format, locale] = await Promise.all([
    getEntityTranslator(definition.namespace),
    getTranslations('MasterData.list'),
    getFormatter(),
    getLocale(),
  ])
  const ctx: CellContext = { definition, t, format, locale, yes: tList('yes'), no: tList('no') }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {definition.columns.map((column) => {
            const label = t(`columns.${column.key}`)
            const numeric = NUMERIC.has(column.kind)
            const sortColumn = column.sortBy ?? column.key
            const sorted = column.sortable === true && params.sort === sortColumn
            const Icon = sorted
              ? params.dir === 'asc'
                ? ArrowUpIcon
                : ArrowDownIcon
              : ArrowUpDownIcon
            return (
              <TableHead
                key={column.key}
                scope="col"
                aria-sort={sorted ? (params.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                className={cn(numeric && 'text-end')}
              >
                {column.sortable ? (
                  <Link
                    href={sortHref(definition.basePath, definition.list, params, sortColumn)}
                    prefetch={false}
                    className="hover:text-foreground inline-flex items-center gap-1"
                  >
                    {label}
                    <Icon
                      aria-hidden="true"
                      className={cn('size-3.5', sorted ? 'opacity-100' : 'opacity-40')}
                    />
                  </Link>
                ) : (
                  label
                )}
              </TableHead>
            )
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={String(row.id)}>
            {definition.columns.map((column) => (
              <TableCell
                key={column.key}
                className={cn(NUMERIC.has(column.kind) && 'text-end tabular-nums')}
              >
                <Cell column={column} row={row} ctx={ctx} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
