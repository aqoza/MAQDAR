import { useLocale, useTranslations } from 'next-intl'
import { TableScrollRegion } from './table-scroll-region'
import { HelpDisclosure } from './help-disclosure'
import type { EventReport } from '@/lib/planned-events'

export function PlannedEventReport({ report }: { report: EventReport }) {
  const t = useTranslations('PlannedEvents')
  const locale = useLocale()
  // Decimal strings remain exact through Intl, including quantities beyond safe integers.
  const format = (value: string) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(value as unknown as number)
  const evidence = report.source.evidence.output
  return (
    <section className="space-y-3" aria-label={t('comparison')}>
      <div className="grid gap-3 sm:grid-cols-3">
        {(['baseline', 'addition', 'adjusted'] as const).map((key) => (
          <div key={key} className="min-w-0 workspace-panel">
            <h2 className="text-subsection-title">{t(key)}</h2>
            <p className="break-words text-section-title tabular-nums">
              <bdi>
                {format(report.totals[key])} {report.input.unit}
              </bdi>
            </p>
          </div>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{t('assumptions')}</p>
      <TableScrollRegion label={t('daily')} className="max-h-96">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('daily')}</caption>
          <thead>
            <tr>
              {(['date', 'baseline', 'addition', 'adjusted'] as const).map((key) => (
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
                {(['baseline', 'addition', 'adjusted'] as const).map((key) => (
                  <td key={key} className="whitespace-nowrap p-3 tabular-nums">
                    <bdi>{format(day[key])}</bdi>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
      <HelpDisclosure label={t('baselineEvidence')}>
        <p>{t('baselineNote')}</p>
        <p>
          {t('model')}: <bdi>{report.source.model}</bdi>
        </p>
        <TableScrollRegion label={t('modelScores')}>
          <table className="w-full text-sm">
            <caption className="sr-only">{t('modelScores')}</caption>
            <thead>
              <tr>
                {(['model', 'rmse', 'mae', 'bias'] as const).map((key) => (
                  <th key={key} className="p-2 text-start">
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {evidence.scores.map((score) => (
                <tr key={score.model}>
                  <td className="p-2">
                    <bdi>{score.model}</bdi>
                  </td>
                  {(['rmse', 'mae', 'bias'] as const).map((key) => (
                    <td key={key} className="p-2 tabular-nums">
                      <bdi>{format(score[key])}</bdi>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollRegion>
        {evidence.uncertainty?.status === 'available' &&
        evidence.uncertainty.bands.length === report.daily.length ? (
          <TableScrollRegion label={t('baselineBands')}>
            <table className="w-full text-sm">
              <caption>{t('baselineBands')}</caption>
              <thead>
                <tr>
                  {(['date', 'lower80', 'upper80', 'lower95', 'upper95'] as const).map((key) => (
                    <th key={key} className="p-2 text-start">
                      {t(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {evidence.uncertainty.bands.map((band, i) => (
                  <tr key={report.daily[i].date}>
                    <td className="p-2 whitespace-nowrap">
                      <bdi>{report.daily[i].date}</bdi>
                    </td>
                    {(['lower80', 'upper80', 'lower95', 'upper95'] as const).map((key) => (
                      <td key={key} className="p-2 tabular-nums">
                        <bdi>{format(band[key])}</bdi>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollRegion>
        ) : (
          <p>{t('noBands')}</p>
        )}
      </HelpDisclosure>
    </section>
  )
}
