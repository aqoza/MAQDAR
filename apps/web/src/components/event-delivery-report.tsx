import Link from 'next/link'
import { EventDeliveryWarnings } from './event-delivery-warnings'
import { useLocale, useTranslations } from 'next-intl'
import { HelpDisclosure } from './help-disclosure'
import { TableScrollRegion } from './table-scroll-region'
import { EventSupplierReport } from './event-supplier-report'
import { isZeroQuantity, type EventDeliveryReport as Report } from '@/lib/event-deliveries'

export function EventDeliveryReport({ report }: { report: Report }) {
  const t = useTranslations('EventDeliveries')
  const calendarText = useTranslations('DeliveryScenarios')
  const locale = useLocale()
  const amount = (value: string) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(value as unknown as number)
  const unit = report.source.draft.scenario.event.input.unit
  return (
    <section className="space-y-3" aria-label={t('comparison')}>
      <p role="status">{t(`statuses.${report.status}`)}</p>
      {report.blocked_stage && (
        <p>{calendarText('blockedStage', { stage: calendarText(report.blocked_stage) })}</p>
      )}
      <div className="workspace-panel">
        <TableScrollRegion label={t('comparison')}>
          <table className="w-full min-w-[30rem] text-sm">
            <caption className="sr-only">{t('comparison')}</caption>
            <thead>
              <tr>
                {(['side', 'quantity', 'orderDate', 'receiptDate'] as const).map((key) => (
                  <th key={key} className="p-3 text-start text-xs">
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(['baseline', 'adjusted'] as const).map((side) => (
                <tr key={side} className="border-t">
                  <th scope="row" className="p-3 text-start font-medium">
                    {t(side)}
                  </th>
                  <td className="p-3 tabular-nums">
                    <bdi>
                      {amount(report.source[side].quantity)} {unit}
                    </bdi>
                  </td>
                  <td className="p-3 tabular-nums">
                    {isZeroQuantity(report.source[side].quantity)
                      ? t('noOrder')
                      : (report.order_date ?? '—')}
                  </td>
                  <td className="p-3 tabular-nums">
                    {isZeroQuantity(report.source[side].quantity)
                      ? t('noOrder')
                      : (report.receipt_date ?? '—')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollRegion>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ['requested', report.input.requested_date],
            ['nominalReceipt', report.nominal_receipt],
            ['expectedReceipt', report.expected_receipt],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="min-w-0 space-y-1 workspace-panel">
            <h2 className="text-subsection-title">{t(key)}</h2>
            <p className="break-words tabular-nums">{value ?? '—'}</p>
          </div>
        ))}
      </div>
      <EventDeliveryWarnings report={report} />
      <p className="text-sm text-muted-foreground">{t('planningOnly')}</p>
      <HelpDisclosure label={t('calendarEvidence')}>
        <p>{t('formula')}</p>
        <p>{t('calendarNote')}</p>
        {(['supplier', 'receiver'] as const).map((stage) => {
          const cal = report[`${stage}_calendar`]
          const search = stage === 'supplier' ? report.order_search : report.receipt_search
          if (!cal) return null
          return (
            <section key={stage} className="space-y-3" aria-label={calendarText(stage)}>
              <h3 className="text-subsection-title">
                {calendarText(stage)} ·{' '}
                <bdi>
                  {cal.calendar_code ?? calendarText('countryDefault')} · {cal.country}
                </bdi>
              </h3>
              <p>
                {calendarText('weekendDays', {
                  days:
                    cal.weekend_days === null
                      ? calendarText('unknown')
                      : cal.weekend_days.length
                        ? cal.weekend_days.map((day) => calendarText(`weekdays.${day}`)).join(', ')
                        : calendarText('none'),
                })}
              </p>
              <p>
                {calendarText(cal.observe_public_holidays ? 'observesHolidays' : 'ignoresHolidays')}
              </p>
              <p>
                {calendarText('coverage', {
                  from: cal.coverage_from ?? calendarText('unknown'),
                  to: cal.coverage_to ?? calendarText('unknown'),
                })}
              </p>
              {search && (
                <TableScrollRegion label={calendarText('evaluatedDays')}>
                  <table className="w-full min-w-[26rem] text-sm">
                    <thead>
                      <tr>
                        {(['date', 'working', 'reason'] as const).map((key) => (
                          <th key={key} className="p-2 text-start text-xs">
                            {calendarText(key)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {search.days.map((day) => (
                        <tr key={day.date} className="border-t">
                          <th scope="row" className="p-2 text-start font-medium">
                            {day.date}
                          </th>
                          <td className="p-2">
                            {calendarText(
                              day.working === null ? 'unknown' : day.working ? 'yes' : 'no',
                            )}
                          </td>
                          <td className="p-2">{calendarText(`reasons.${day.reason}`)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScrollRegion>
              )}
              <details>
                <summary>{calendarText('references')}</summary>
                <p className="break-words">
                  {calendarText('calendarIdentity', {
                    id: cal.calendar_id ?? '—',
                    time: cal.calendar_updated_at ?? '—',
                  })}
                </p>
                <h4 className="text-subsection-title">{calendarText('overrides')}</h4>
                {!cal.overrides.length && <p>{calendarText('none')}</p>}
                <ul>
                  {cal.overrides.map((o) => (
                    <li key={o.id}>
                      {o.starts_on} – {o.ends_on} · {o.name} · {calendarText(o.kind)} ·{' '}
                      {calendarText(o.calendar_id ? 'calendarScope' : 'countryScope')}
                    </li>
                  ))}
                </ul>
                <h4 className="text-subsection-title">{calendarText('holidays')}</h4>
                {!cal.holidays.length && <p>{calendarText('noneRecorded')}</p>}
                <ul>
                  {cal.holidays.map((h) => (
                    <li key={`${h.date}-${h.sector}`}>
                      {h.date} · {h.name} · {h.sector} · {h.source}
                    </li>
                  ))}
                </ul>
              </details>
            </section>
          )
        })}
      </HelpDisclosure>
      <HelpDisclosure label={t('sourceEvidence')}>
        <Link
          className="underline"
          href={`/replenishment/events/suppliers/${report.input.scenario_id}`}
        >
          {t('source')}
        </Link>
        <EventSupplierReport report={report.source} />
      </HelpDisclosure>
    </section>
  )
}
