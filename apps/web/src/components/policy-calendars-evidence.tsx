import { getTranslations } from 'next-intl/server'
import type { CalendarPreview } from '@/lib/policy-calendars'
import { TableScrollRegion } from '@/components/table-scroll-region'

export async function PolicyCalendarsEvidence({ evidence }: { evidence: CalendarPreview }) {
  const t = await getTranslations('PolicyCalendars')
  return (
    <details className="workspace-panel">
      <summary className="min-h-11 cursor-pointer py-2 font-medium">{t('evidence')}</summary>
      <p className="mb-3 text-xs">{t('captureMeaning')}</p>
      {(['ordering', 'receiving'] as const).map((stage) => {
        const calendar = evidence.calendars[stage]
        return (
          <section key={stage} className="mb-4 min-w-0 space-y-2">
            <h2 className="text-subsection-title">
              {t(stage)} · {calendar.calendar_code ?? t('countryDefault')}
            </h2>
            <p className="text-xs">
              {t('coverage', {
                from: calendar.coverage_from ?? '—',
                to: calendar.coverage_to ?? '—',
              })}{' '}
              · {calendar.country ?? '—'}
            </p>
            <p className="text-xs">
              {t('settings', {
                weekends: calendar.weekend_days?.join(', ') || '—',
                holidays: calendar.observe_public_holidays ? t('yes') : t('no'),
              })}
            </p>
            <TableScrollRegion label={t(stage)} className="max-h-80">
              <table className="w-full min-w-[440px] text-sm">
                <thead className="text-xs [&_th]:font-medium">
                  <tr>
                    {(['date', 'working', 'reason'] as const).map((key) => (
                      <th key={key} className="p-2 text-start text-xs">
                        {t(key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.values(evidence.calendars[`${stage}_days`]).map((day) => (
                    <tr key={day.date} className="border-t">
                      <td className="p-2">{day.date}</td>
                      <td className="p-2">
                        {day.working === null ? t('unknown') : day.working ? t('yes') : t('no')}
                      </td>
                      <td className="p-2">{t(`reasons.${day.reason}`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScrollRegion>
            <details>
              <summary className="min-h-11 cursor-pointer py-2">{t('references')}</summary>
              <pre
                className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md border p-3 text-xs"
                dir="ltr"
              >
                {JSON.stringify(calendar, null, 2)}
              </pre>
            </details>
          </section>
        )
      })}
    </details>
  )
}
