import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import type { z } from 'zod'
import type { forecastReadEvidenceSchema as forecastEvidenceSchema } from '@/lib/forecasting'

export async function PreparedForecastDetails({
  detail,
  locale,
}: {
  detail: z.infer<typeof forecastEvidenceSchema>
  locale: string
}) {
  const t = await getTranslations('PreparedForecast')
  const source = detail.source.preparation
  if (!source) return null
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 6 })
  const number = (value: string | number) => formatter.format(value as number)
  const flag = (value: boolean | null) => t(value === null ? 'unknown' : value ? 'yes' : 'no')
  const model = detail.output.calendar_model
  return (
    <div className="space-y-4 workspace-panel">
      <p>{t('units', { unit: source.unit })}</p>
      <p className="text-sm">
        {t('window', {
          from: source.original_from,
          used: detail.source.start_day,
          to: detail.source.end_day,
        })}
      </p>
      <Link
        className="underline"
        href={`/forecasts/prepared/${source.run_id}?group=${source.group_id}`}
      >
        {t('preparationLink')}
      </Link>
      {model && (
        <>
          <h3 className="text-subsection-title">{t('effectsTitle')}</h3>
          <p className="text-sm">{t('effectsNote')}</p>
          <p>
            {t(detail.output.model === 'calendar' ? 'candidateSelected' : 'candidateNotSelected')}
          </p>
          <p>
            {t('unknownCounts', {
              history: model.unknown_training_days,
              future: model.unknown_future_days,
            })}
          </p>
          <div className="workspace-table overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{t('effectsTitle')}</caption>
              <thead>
                <tr>
                  {(['event', 'days', 'ordinaryDays', 'support', 'adjustment'] as const).map(
                    (key) => (
                      <th key={key} className="p-2 text-start">
                        {t(key)}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {model.effects.map((effect) => (
                  <tr className="border-t" key={effect.event}>
                    <td className="p-2">{t(effect.event)}</td>
                    <td className="p-2">{number(effect.days)}</td>
                    <td className="p-2">{number(effect.ordinary_days)}</td>
                    <td className="p-2">{t(effect.status)}</td>
                    <td className="p-2 tabular-nums">{number(effect.adjustment)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary className="cursor-pointer">{t('weekdays')}</summary>
            <table className="w-full text-sm">
              <caption className="sr-only">{t('weekdays')}</caption>
              <thead>
                <tr>
                  {(['weekday', 'days', 'mean'] as const).map((key) => (
                    <th key={key} className="p-2 text-start">
                      {t(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {model.weekdays.map((day) => (
                  <tr key={day.day} className="border-t">
                    <td className="p-2">{t(`dayNames.${day.day}`)}</td>
                    <td className="p-2">{number(day.days)}</td>
                    <td className="p-2">{number(day.mean)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
      {!!detail.output.future_calendar?.length && (
        <details>
          <summary className="cursor-pointer">{t('futureCalendar')}</summary>
          <p className="my-2 text-sm">{t('futureNote')}</p>
          <table className="w-full text-sm">
            <caption className="sr-only">{t('futureCalendar')}</caption>
            <thead>
              <tr>
                {(['date', 'verified', 'holiday', 'ramadan', 'working'] as const).map((key) => (
                  <th key={key} className="p-2 text-start">
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.output.future_calendar.map((day) => (
                <tr key={day.date} className="border-t">
                  <td className="p-2">{day.date}</td>
                  <td className="p-2">{flag(day.calendar_verified)}</td>
                  <td className="p-2">{flag(day.holiday)}</td>
                  <td className="p-2">{flag(day.ramadan)}</td>
                  <td className="p-2">{flag(day.working)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  )
}
