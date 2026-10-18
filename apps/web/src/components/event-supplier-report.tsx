import Link from 'next/link'
import { useLocale, useTranslations, useFormatter } from 'next-intl'
import { HelpDisclosure } from './help-disclosure'
import { TableScrollRegion } from './table-scroll-region'
import { EventReplenishmentReport } from './event-replenishment-report'
import type { EventSupplierReport as Report } from '@/lib/event-suppliers'

export function EventSupplierReport({ report }: { report: Report }) {
  const t = useTranslations('EventSuppliers')
  const locale = useLocale()
  const format = useFormatter()
  const amount = (value: string) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(value as unknown as number)
  const unit = report.draft.scenario.event.input.unit
  const orders = report.draft.baseline.orders
  return (
    <section className="space-y-3" aria-label={t('comparison')}>
      <div className="grid gap-3 md:grid-cols-3">
        {(
          [
            ['baselineQuantity', report.baseline.quantity],
            ['adjustedQuantity', report.adjusted.quantity],
            ['increase', report.quantity_increase],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="min-w-0 space-y-2 workspace-panel">
            <h2 className="text-subsection-title">{t(key)}</h2>
            <p className="break-words text-section-title tabular-nums">
              <bdi>
                {amount(value)} {unit}
              </bdi>
            </p>
          </div>
        ))}
      </div>
      <div className="space-y-3 workspace-panel">
        <h2 className="text-section-title">
          <bdi>
            {report.supplier.code} · {report.supplier.name}
          </bdi>
        </h2>
        <dl className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ['moq', amount(report.terms.moq) + ' ' + unit],
              ['pack', amount(report.terms.pack) + ' ' + unit],
              ['lead', t('days', { days: report.terms.lead_time })],
            ] as const
          ).map(([key, value]) => (
            <div key={key}>
              <dt className="text-sm text-muted-foreground">{t(key)}</dt>
              <dd className="break-words tabular-nums">
                <bdi>{value}</bdi>
              </dd>
            </div>
          ))}
        </dl>
        <TableScrollRegion label={t('comparison')}>
          <table className="w-full min-w-[26rem] text-sm">
            <caption className="sr-only">{t('comparison')}</caption>
            <thead>
              <tr>
                {(['measure', 'baseline', 'adjusted'] as const).map((key) => (
                  <th key={key} className="p-3 text-start text-xs">
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(['gap', 'quantity', 'overage'] as const).map((key) => (
                <tr key={key} className="border-t">
                  <th scope="row" className="p-3 text-start font-medium">
                    {t(key)}
                  </th>
                  {(['baseline', 'adjusted'] as const).map((side) => (
                    <td key={side} className="p-3 tabular-nums">
                      <bdi>
                        {amount(report[side][key])} {unit}
                      </bdi>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollRegion>
      </div>
      {orders.some((order) => order.overdue || order.late) && (
        <p
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
        >
          {t('timingWarning')}
        </p>
      )}
      <p className="text-sm text-muted-foreground">{t('planningOnly')}</p>
      <HelpDisclosure label={t('evidence')}>
        <p>{t('formula')}</p>
        <p>{t('fixedEvidence')}</p>
        <p>{t('confirmation', { date: report.draft.scenario.event.source.cutoff })}</p>
        <p>
          {t('capturedTerms', { time: format.dateTime(new Date(report.terms.updated_at), 'long') })}
        </p>
        <Link
          className="inline-block underline"
          href={`/replenishment/events/${report.input.draft_id}`}
        >
          {t('source')}
        </Link>
        <EventReplenishmentReport report={report.draft} />
      </HelpDisclosure>
    </section>
  )
}
