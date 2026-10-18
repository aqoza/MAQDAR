import { HelpDisclosure } from '@/components/help-disclosure'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { formatScore } from '@/lib/forecast-quality'
import type { DeliveryScenarioReport as Report } from '@/lib/delivery-scenarios'

export async function DeliveryScenarioReport({
  report,
  locale,
}: {
  report: Report
  locale: string
}) {
  const t = await getTranslations('DeliveryScenarios')
  return (
    <section className="space-y-4" aria-label={t('result')}>
      <h2 className="text-section-title">{t('result')}</h2>
      <p role="status">{t(`statuses.${report.status}`)}</p>
      {report.blocked_stage && <p>{t('blockedStage', { stage: t(report.blocked_stage) })}</p>}
      <p>
        {report.source.item_code} · {report.source.location_code} · {report.source.supplier_code}
      </p>
      <p>
        {t('savedQuantity', {
          quantity: formatScore(report.source.quantity, locale),
          unit: report.source.unit ?? '—',
          lead: report.source.lead_time ?? '—',
        })}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ['requested', report.requested_date],
            ['orderDate', report.order_date],
            ['nominalReceipt', report.nominal_receipt],
            ['receiptDate', report.receipt_date],
            ['expectedReceipt', report.expected_receipt],
          ] as const
        ).map(([label, date]) => (
          <div className="workspace-panel" key={label}>
            <p className="text-sm text-muted-foreground">{t(label)}</p>
            <p className="text-evidence-value tabular-nums">{date ?? '—'}</p>
          </div>
        ))}
      </div>
      {report.elapsed_days !== null && <p>{t('elapsed', { days: report.elapsed_days })}</p>}
      {report.policy_recalculation_required !== null && (
        <p className="workspace-panel font-semibold">
          {t(report.policy_recalculation_required ? 'recalculate' : 'withinLead')}
        </p>
      )}
      <p>{t(report.calendars_confirmed ? 'confirmed' : 'unconfirmed')}</p>
      <HelpDisclosure>
        <p>{t('scenarioNote')}</p>
      </HelpDisclosure>
      {(['supplier', 'receiver'] as const).map((stage) => {
        const cal = report[`${stage}_calendar`]
        const search = stage === 'supplier' ? report.order_search : report.receipt_search
        if (!cal) return null
        return (
          <section className="space-y-3 workspace-panel" key={stage} aria-label={t(stage)}>
            <h3 className="text-subsection-title">
              {t(stage)} · {cal.calendar_code ?? t('countryDefault')} · {cal.country}
            </h3>
            <p>
              {t('weekendDays', {
                days:
                  cal.weekend_days === null
                    ? t('unknown')
                    : cal.weekend_days.length
                      ? cal.weekend_days.map((day) => t(`weekdays.${day}`)).join(', ')
                      : t('none'),
              })}
            </p>
            <p>{t(cal.observe_public_holidays ? 'observesHolidays' : 'ignoresHolidays')}</p>
            <p>
              {t('coverage', {
                from: cal.coverage_from ?? t('unknown'),
                to: cal.coverage_to ?? t('unknown'),
              })}
            </p>
            {search && (
              <div className="workspace-table overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="text-start">{t('evaluatedDays')}</caption>
                  <thead>
                    <tr>
                      {(['date', 'working', 'reason'] as const).map((key) => (
                        <th key={key} className="p-2 text-start">
                          {t(key)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {search.days.map((day) => (
                      <tr key={day.date} className="border-t">
                        <th className="p-2 text-start">{day.date}</th>
                        <td className="p-2">
                          {t(day.working === null ? 'unknown' : day.working ? 'yes' : 'no')}
                        </td>
                        <td className="p-2">{t(`reasons.${day.reason}`)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <details>
              <summary>{t('references')}</summary>
              <p>
                {t('calendarIdentity', {
                  id: cal.calendar_id ?? '—',
                  time: cal.calendar_updated_at ?? '—',
                })}
              </p>
              <h4 className="mt-2 font-semibold">{t('overrides')}</h4>
              {!cal.overrides.length && <p>{t('none')}</p>}
              <ul className="space-y-2">
                {cal.overrides.map((override) => (
                  <li key={override.id}>
                    {override.starts_on} – {override.ends_on} · {override.name} · {t(override.kind)}{' '}
                    · {t(override.calendar_id ? 'calendarScope' : 'countryScope')}
                  </li>
                ))}
              </ul>
              <h4 className="mt-2 font-semibold">{t('holidays')}</h4>
              {!cal.holidays.length && <p>{t('noneRecorded')}</p>}
              <ul className="space-y-2">
                {cal.holidays.map((holiday) => (
                  <li key={`${holiday.date}-${holiday.sector}`}>
                    {holiday.date} · {holiday.name} · {holiday.sector} · {holiday.source}
                  </li>
                ))}
              </ul>
            </details>
          </section>
        )
      })}
      <Link
        className="inline-block underline"
        href={`/replenishment/suppliers/${report.source.scenario_id}`}
      >
        {t('source')}
      </Link>
    </section>
  )
}
