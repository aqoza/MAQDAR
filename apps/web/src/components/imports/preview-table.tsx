import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export type PreviewColumn = {
  key: string
  label: string
  /** Shown under the label (the contract column name), left to right. */
  name?: string
  /** Codes, numbers and dates: isolated left to right in a monospace face. */
  ltr?: boolean
}

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/

/**
 * A small table of file rows (raw, or normalized as they will be staged). Codes and numbers sit
 * in `<bdi dir="ltr">`; Arabic text gets `lang="ar" dir="rtl"`; empty cells show a muted dash.
 * Works in server and client trees.
 */
export function PreviewTable({
  columns,
  rows,
  emptyLabel,
  caption,
}: {
  columns: readonly PreviewColumn[]
  rows: readonly (readonly (string | null)[])[]
  /** Accessible text of an empty cell. */
  emptyLabel: string
  caption?: string
}) {
  return (
    <div className="max-h-96 overflow-auto rounded-lg border">
      <Table>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <TableHeader className="bg-muted/50">
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.key} className="align-bottom">
                <div className="flex flex-col items-start py-1">
                  <span>{column.label}</span>
                  {column.name && column.name !== column.label ? (
                    <code className="text-muted-foreground text-xs font-normal" dir="ltr">
                      {column.name}
                    </code>
                  ) : null}
                </div>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, rowIndex) => (
            <TableRow key={rowIndex}>
              {columns.map((column, index) => {
                const value = row[index] ?? ''
                if (value === '') {
                  return (
                    <TableCell key={column.key} className="text-muted-foreground">
                      <span aria-label={emptyLabel}>—</span>
                    </TableCell>
                  )
                }
                if (column.ltr) {
                  return (
                    <TableCell key={column.key}>
                      <bdi dir="ltr" className="font-mono text-xs">
                        {value}
                      </bdi>
                    </TableCell>
                  )
                }
                return (
                  <TableCell key={column.key} className="max-w-64 truncate" title={value}>
                    {ARABIC.test(value) ? (
                      <span lang="ar" dir="rtl">
                        {value}
                      </span>
                    ) : (
                      <bdi>{value}</bdi>
                    )}
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
