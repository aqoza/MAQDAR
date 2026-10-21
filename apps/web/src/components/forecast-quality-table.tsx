'use client'

import { Fragment, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { TableScrollRegion } from '@/components/table-scroll-region'
import styles from './forecast-quality.module.css'

export type ForecastQualityRecord = {
  id: string
  itemCode: string
  itemName: string
  href: string
  location: string
  window: ReactNode
  model: string
  result: string
  rmse: string
  mae: string
  bias: string
  inspectLabel: string
  hideLabel: string
  evidence: ReactNode
}

export function ForecastQualityTable({
  records,
  label,
  columns,
}: {
  records: ForecastQualityRecord[]
  label: string
  columns: string[]
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <TableScrollRegion label={label} className={styles.tableRegion}>
      <table className={styles.table}>
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((record) => {
            const open = expanded.has(record.id)
            const panelId = `quality-evidence-${record.id}`
            const control = (className: string, compact = false) => (
              <button
                type="button"
                className={`${styles.inspect} ${className}`}
                aria-expanded={open}
                aria-controls={panelId}
                aria-label={open ? record.hideLabel : record.inspectLabel}
                onClick={() => toggle(record.id)}
              >
                {open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                {compact ? columns.at(-1) : open ? record.hideLabel : record.inspectLabel}
              </button>
            )
            return (
              <Fragment key={record.id}>
                <tr className={styles.dataRow}>
                  <th scope="row">
                    <Link prefetch={false} href={record.href} className="font-semibold underline">
                      {record.itemCode}
                    </Link>
                    <p className="mt-0.5 font-normal">{record.itemName}</p>
                    {control(styles.mobileInspect, true)}
                  </th>
                  <td>{record.location}</td>
                  <td>{record.window}</td>
                  <td>{record.model}</td>
                  <td>{record.result}</td>
                  <td className="tabular-nums">{record.rmse}</td>
                  <td className="tabular-nums">{record.mae}</td>
                  <td className="tabular-nums">{record.bias}</td>
                  <td>{control(styles.desktopInspect)}</td>
                </tr>
                {open && (
                  <tr data-testid="quality-evidence-row">
                    <td colSpan={columns.length} className={styles.evidenceCell}>
                      <section
                        id={panelId}
                        aria-label={record.inspectLabel}
                        className={styles.evidencePanel}
                        data-testid="quality-evidence"
                      >
                        {record.evidence}
                      </section>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </TableScrollRegion>
  )
}
