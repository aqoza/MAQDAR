import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { TableScrollRegion } from './table-scroll-region'
import { HelpDisclosure } from './help-disclosure'
import type { EventPolicyReport as Report } from '@/lib/event-policies'

export function EventPolicyReport({ report }: { report: Report }) {
  const t = useTranslations('EventPolicies')
  const locale = useLocale()
  const format = (value: string) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(value as unknown as number)
  const unit = report.event.input.unit
  const options = report.policy.evidence.options
  return (
    <section className="space-y-3" aria-label={t('comparison')}>
      <div className="grid gap-3 md:grid-cols-2">
        {(['lead_time', 'protection'] as const).map((key) => {
          const period = report.periods[key]
          return (
            <div key={key} className="min-w-0 space-y-3 workspace-panel">
              <h2 className="text-subsection-title">{t(key)}</h2>
              <p className="text-xs text-muted-foreground">
                {t('period', { start: report.event.source.cutoff, days: period.baseline.days })}
              </p>
              <p className="break-words text-evidence-value tabular-nums">
                <bdi>
                  {format(period.adjusted.target)} {unit}
                </bdi>
              </p>
              <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 text-sm">
                {(['forecast', 'target', 'safety_stock'] as const).map((field) => (
                  <div key={field} className="col-span-2 grid grid-cols-subgrid gap-2">
                    <dt>{t(field)}</dt>
                    <dd className="break-words text-end tabular-nums">
                      <bdi>
                        {format(period.baseline[field])} → {format(period.adjusted[field])}
                      </bdi>
                    </dd>
                  </div>
                ))}
                <dt>{t('addition')}</dt>
                <dd className="break-words text-end tabular-nums">
                  <bdi>{format(period.addition)}</bdi>
                </dd>
              </dl>
            </div>
          )
        })}
      </div>
      <p className="text-sm text-muted-foreground">{t('assumptions')}</p>
      <HelpDisclosure label={t('evidence')}>
        <p className="text-xs">
          {t('parameters', {
            lead: options.lead_time,
            review: options.review_interval,
            service: new Intl.NumberFormat(locale, {
              style: 'percent',
              maximumFractionDigits: 1,
            }).format(options.service_level as unknown as number),
          })}
        </p>
        <p className="text-xs">
          {t('outside', { quantity: format(report.outside_addition), unit })}
        </p>
        <p className="text-xs">{t('baselineNote')}</p>
        <div className="flex flex-wrap gap-4">
          <Link className="underline" href={`/forecasts/events/${report.input.event_id}`}>
            {t('eventSource')}
          </Link>
          <Link className="underline" href={`/forecasts/policies/${report.policy.run_id}`}>
            {t('policySource')}
          </Link>
        </div>
        <TableScrollRegion label={t('daily')} className="max-h-96">
          <table className="w-full text-sm">
            <caption className="sr-only">{t('daily')}</caption>
            <thead className="text-xs [&_th]:font-medium">
              <tr>
                {(['date', 'addition', 'leadWindow', 'protectionWindow'] as const).map((key) => (
                  <th key={key} className="p-3 text-start">
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.daily.map((day) => (
                <tr key={day.date} className="border-t">
                  <td className="whitespace-nowrap p-3">
                    <bdi>{day.date}</bdi>
                  </td>
                  <td className="whitespace-nowrap p-3 tabular-nums">
                    <bdi>{format(day.addition)}</bdi>
                  </td>
                  <td className="p-3">{t(day.in_lead_time ? 'included' : 'excluded')}</td>
                  <td className="p-3">{t(day.in_protection ? 'included' : 'excluded')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollRegion>
      </HelpDisclosure>
    </section>
  )
}
