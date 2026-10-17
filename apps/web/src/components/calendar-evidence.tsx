import type { z } from 'zod'
import { getTranslations } from 'next-intl/server'
import type { calendarEvidenceSchema, calendarSearchSchema } from '@/lib/delivery-scenarios'
import { TableScrollRegion } from './table-scroll-region'

/** Captured calendar settings and evaluated dates; no inference from absent holiday rows. */
export async function CalendarEvidence({
  title,
  calendar,
  search,
}: {
  title: string
  calendar: z.infer<typeof calendarEvidenceSchema>
  search: z.infer<typeof calendarSearchSchema> | null
}) {
  const t = await getTranslations('DeliveryScenarios')
  return (
    <details className="workspace-panel min-w-0 space-y-3 wrap-anywhere">
      <summary>{title}</summary>
      <p>
        {calendar.calendar_code ?? t('countryDefault')} · {calendar.country}
      </p>
      <p>
        {t('weekendDays', {
          days:
            calendar.weekend_days === null
              ? t('unknown')
              : calendar.weekend_days.length
                ? calendar.weekend_days.map((day) => t(`weekdays.${day}`)).join(', ')
                : t('none'),
        })}
      </p>
      <p>{t(calendar.observe_public_holidays ? 'observesHolidays' : 'ignoresHolidays')}</p>
      <p>
        {t('coverage', {
          from: calendar.coverage_from ?? t('unknown'),
          to: calendar.coverage_to ?? t('unknown'),
        })}
      </p>
      {search && (
        <TableScrollRegion label={title}>
          <table className="w-full min-w-[30rem] text-sm">
            <caption className="sr-only">{t('evaluatedDays')}</caption>
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
                <tr className="border-t" key={day.date}>
                  <th className="p-2 text-start whitespace-nowrap">{day.date}</th>
                  <td className="p-2">
                    {t(day.working === null ? 'unknown' : day.working ? 'yes' : 'no')}
                  </td>
                  <td className="p-2">{t(`reasons.${day.reason}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollRegion>
      )}
      <details className="space-y-2">
        <summary>{t('references')}</summary>
        <p>
          {t('calendarIdentity', {
            id: calendar.calendar_id ?? '—',
            time: calendar.calendar_updated_at ?? '—',
          })}
        </p>
        <h4 className="font-semibold">{t('overrides')}</h4>
        {!calendar.overrides.length && <p>{t('none')}</p>}
        <ul className="space-y-2">
          {calendar.overrides.map((override) => (
            <li key={override.id}>
              {override.starts_on} – {override.ends_on} · {override.name} · {t(override.kind)} ·{' '}
              {t(override.calendar_id ? 'calendarScope' : 'countryScope')}
              <p>
                {override.id} · {override.updated_at}
              </p>
            </li>
          ))}
        </ul>
        <h4 className="font-semibold">{t('holidays')}</h4>
        {!calendar.holidays.length && <p>{t('noneRecorded')}</p>}
        <ul className="space-y-2">
          {calendar.holidays.map((holiday) => (
            <li key={`${holiday.date}-${holiday.sector}`}>
              {holiday.date} · {holiday.name} · {holiday.sector} · {holiday.source}
            </li>
          ))}
        </ul>
      </details>
    </details>
  )
}
