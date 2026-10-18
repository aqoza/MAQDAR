import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { HelpDisclosure } from './help-disclosure'
import { TableScrollRegion } from './table-scroll-region'
import type { EventDraftReport } from '@/lib/event-replenishment'

export function EventReplenishmentReport({ report }: { report: EventDraftReport }) {
  const t = useTranslations('EventReplenishment')
  const locale = useLocale()
  const amount = (value: string | null | undefined) =>
    value == null
      ? '—'
      : new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(
          value as unknown as number,
        )
  const baseline = report.baseline
  const stock = baseline.policy.snapshot
  const unit = report.scenario.event.input.unit
  const overdue = baseline.orders.filter((order) => order.overdue).length
  const late = baseline.orders.filter((order) => order.late).length
  return (
    <section className="space-y-3" aria-label={t('comparison')}>
      <div className="grid gap-3 md:grid-cols-3">
        {(['baseline_gap', 'adjusted_gap', 'gap_increase'] as const).map((key) => (
          <div key={key} className="min-w-0 space-y-2 workspace-panel">
            <h2 className="text-subsection-title">{t(key)}</h2>
            <p className="break-words text-section-title tabular-nums">
              <bdi>
                {amount(report[key])} {unit}
              </bdi>
            </p>
          </div>
        ))}
      </div>
      <dl className="grid gap-x-6 gap-y-2 workspace-panel sm:grid-cols-2 lg:grid-cols-3">
        {(
          [
            ['stockAvailable', stock?.available],
            ['inbound', baseline.inbound_quantity],
            ['backorders', report.input.backorders],
            ['position', baseline.inventory_position],
            ['baselineMaximum', report.baseline_maximum],
            ['adjustedMaximum', report.adjusted_maximum],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="flex min-w-0 flex-wrap justify-between gap-2">
            <dt className="text-sm text-muted-foreground">{t(key)}</dt>
            <dd className="break-words tabular-nums">
              <bdi>
                {amount(value)} {unit}
              </bdi>
            </dd>
          </div>
        ))}
      </dl>
      {(overdue > 0 || late > 0) && (
        <p
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
        >
          {t('timingWarning', { overdue, late, date: baseline.protection_end ?? '—' })}
        </p>
      )}
      <p className="text-sm text-muted-foreground">{t('planningOnly')}</p>
      <HelpDisclosure label={t('evidence')}>
        <p>{t('formula')}</p>
        <p>{t('assumptions')}</p>
        <p>{t('cutoff', { date: report.scenario.event.source.cutoff })}</p>
        <p>{t('confirmOrders')}</p>
        <p>{t('confirmEvent')}</p>
        {stock && (
          <p>
            {t('stockEvidence', {
              date: stock.date,
              quantity: amount(stock.quantity),
              allocated: amount(stock.allocated),
              unit,
            })}
          </p>
        )}
        <TableScrollRegion label={t('orders')} className="max-h-96">
          <table className="w-full min-w-[36rem] text-sm">
            <caption className="sr-only">{t('orders')}</caption>
            <thead>
              <tr>
                {(['order', 'supplier', 'expected', 'remaining', 'timing'] as const).map((key) => (
                  <th key={key} className="p-3 text-start text-xs">
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {baseline.orders.map((order) => (
                <tr key={order.id} className="border-t">
                  <td className="p-3">
                    <bdi>
                      {order.order_code} / {order.line_code}
                    </bdi>
                  </td>
                  <td className="p-3">
                    <bdi>{order.supplier_code ?? '—'}</bdi>
                  </td>
                  <td className="p-3">
                    <bdi>{order.expected_date}</bdi>
                  </td>
                  <td className="p-3 tabular-nums">
                    <bdi>
                      {amount(order.quantity)} {order.unit}
                    </bdi>
                  </td>
                  <td className="p-3">
                    {t(order.overdue ? 'overdue' : order.late ? 'late' : 'within')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollRegion>
        {baseline.orders.length === 0 && <p>{t('noOrders')}</p>}
        <Link
          className="inline-block underline"
          href={`/forecasts/events/policies/${report.input.scenario_id}`}
        >
          {t('source')}
        </Link>
      </HelpDisclosure>
    </section>
  )
}
