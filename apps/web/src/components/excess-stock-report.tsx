import Link from 'next/link'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import type { ExcessReport } from '@/lib/excess-stock'
import { formatCostDecimal } from '@/lib/purchase-costs'
import { TableScrollRegion } from './table-scroll-region'

export async function ExcessStockReport({ report }: { report: ExcessReport }) {
  const [t, stock, locale, format] = await Promise.all([
    getTranslations('ExcessStock'),
    getTranslations('StockComparison'),
    getLocale(),
    getFormatter(),
  ])
  const number = (v: string | null) => formatCostDecimal(v, locale, 100)
  const date = (v: string) => format.dateTime(new Date(v), { dateStyle: 'medium', timeZone: 'UTC' })
  return (
    <section className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-section-title">
          <bdi>{report.location_code}</bdi> · {date(report.cutoff)}
        </h2>
        <p role={report.status === 'available' ? 'status' : 'alert'}>{t(report.status)}</p>
      </div>
      {report.totals && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={t('totals')}>
          {report.totals.map((total) => (
            <div key={total.currency} className="workspace-panel space-y-1">
              <h3 className="text-subsection-title">{t('valueAbove')}</h3>
              <p className="text-section-title tabular-nums">
                <bdi>
                  {number(total.value)} {total.currency}
                </bdi>
              </p>
            </div>
          ))}
        </div>
      )}
      <TableScrollRegion label={t('lines')}>
        <table className="w-full min-w-[48rem] text-sm">
          <thead>
            <tr>
              {(
                ['item', 'maximum', 'snapshot', 'quantityAbove', 'valueAbove', 'evidence'] as const
              ).map((key) => (
                <th key={key} className="p-3 text-start text-xs font-medium">
                  {t(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.lines.map((line) => {
              const c = line.comparison
              const s = c.snapshot
              return (
                <tr key={line.item_id} className="border-t align-top">
                  <th className="p-3 text-start font-medium">
                    <bdi>{c.item_code}</bdi>
                    <p className="font-normal">{c.unit ?? '—'}</p>
                  </th>
                  <td className="p-3">
                    <p className="whitespace-nowrap tabular-nums">{number(c.maximum)}</p>
                    <p>
                      {c.basis === 'calculated'
                        ? t('calculated')
                        : t('approved', { revision: c.revision ?? 0 })}
                    </p>
                  </td>
                  <td className="p-3">
                    <p className="whitespace-nowrap">{s ? date(s.date) : '—'}</p>
                    <p>{stock(`statuses.${c.status}`)}</p>
                  </td>
                  <td className="whitespace-nowrap p-3 tabular-nums">
                    {number(c.quantity_above)} {c.unit ?? ''}
                  </td>
                  <td className="whitespace-nowrap p-3 tabular-nums">
                    <bdi>
                      {number(c.value_above)} {c.value_above !== null ? s?.currency : ''}
                    </bdi>
                  </td>
                  <td className="min-w-64 max-w-md p-3">
                    <details>
                      <summary className="cursor-pointer">
                        {t('inspect', { item: c.item_code })}
                      </summary>
                      <div className="mt-2 space-y-2 break-words">
                        <Link className="underline" href={`/forecasts/workbench/${c.policy_id}`}>
                          {t('policy')}
                        </Link>
                        {s && (
                          <dl className="grid grid-cols-2 gap-2">
                            {(
                              [
                                ['onHand', s.quantity],
                                ['allocated', s.allocated],
                                ['stockAvailable', s.available],
                                ['unitCost', `${number(s.unit_cost)} ${s.currency}`],
                              ] as const
                            ).map(([key, value]) => (
                              <div key={key}>
                                <dt className="text-xs text-muted-foreground">{t(key)}</dt>
                                <dd>{key === 'unitCost' ? value : number(value)}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                        {line.override && (
                          <p>
                            {t('overrideReason')}: {line.override.reason} ·{' '}
                            {line.override.decision_reason}
                          </p>
                        )}
                        <details>
                          <summary className="cursor-pointer">{t('savedInputs')}</summary>
                          <pre className="mt-2 max-w-sm whitespace-pre-wrap break-all text-xs">
                            {JSON.stringify(line, null, 2)}
                          </pre>
                        </details>
                      </div>
                    </details>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </TableScrollRegion>
    </section>
  )
}
