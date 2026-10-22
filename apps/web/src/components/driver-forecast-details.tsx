import Link from 'next/link'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { forecastReadEvidenceSchema as forecastEvidenceSchema } from '@/lib/forecasting'
import { ExternalDriverReport } from './external-driver-report'
import { TableScrollRegion } from './table-scroll-region'
import { HelpDisclosure } from './help-disclosure'

export async function DriverForecastDetails({
  detail,
}: {
  detail: z.infer<typeof forecastEvidenceSchema>
}) {
  const drivers = detail.drivers ?? (detail.driver ? [detail.driver] : [])
  if (!drivers.length) return null
  const multi = !!detail.drivers
  const [t, messages] = await Promise.all([
    getTranslations(multi ? 'MultiDriverForecast' : 'DriverForecast'),
    getMessages(),
  ])
  const fit = detail.output.driver_model
  const sets = [
    { label: t('selectionChecks'), checks: detail.output.driver_checks },
    { label: t('evaluationChecks'), checks: detail.output.evaluation?.driver_checks },
  ]
  return (
    <section className="min-w-0 space-y-4">
      <h3 className="text-subsection-title">{t('evidence')}</h3>
      <p className="text-sm">{t('conditionalNote')}</p>
      <HelpDisclosure label={t('methodDetails')}>
        <p>{t('availabilityNote')}</p>
        <p>{t('uncertainty')}</p>
      </HelpDisclosure>
      <div className="flex flex-wrap gap-4 text-sm">
        {drivers.map((d) => (
          <div key={d.id} className="min-w-0 break-words">
            <Link className="underline" href={`/forecasts/drivers/${d.id}`}>
              {d.report.input.driver_name} · {t('dataset')}
            </Link>
            <p className="text-xs">
              {t('importedAt')} <bdi>{d.imported_at}</bdi>
            </p>
          </div>
        ))}
        {detail.original_forecast && (
          <Link
            className="underline"
            href={`/forecasts/results/${detail.original_forecast.run_id}`}
          >
            {t('sourceForecast')}
          </Link>
        )}
      </div>
      {sets.map(({ label, checks }) =>
        checks?.length ? (
          <TableScrollRegion key={label} label={label}>
            <table className="w-full min-w-[36rem] text-sm">
              <caption className="p-2 text-start text-xs font-medium">{label}</caption>
              <thead>
                <tr>
                  {(['cutoff', 'stage', 'status', 'reason', 'date', 'phase'] as const).map((k) => (
                    <th key={k} className="p-2 text-start text-xs font-medium">
                      {t(k)}
                    </th>
                  ))}
                  {multi && <th className="p-2 text-start text-xs font-medium">{t('dataset')}</th>}
                </tr>
              </thead>
              <tbody>
                {checks.map((c, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2">
                      <bdi>{c.cutoff}</bdi>
                    </td>
                    <td className="p-2">{t(c.stage)}</td>
                    <td className="p-2">{t(c.status)}</td>
                    <td className="p-2">{c.reason ? t(c.reason) : '—'}</td>
                    <td className="p-2">
                      <bdi>{c.date ?? '—'}</bdi>
                    </td>
                    <td className="p-2">{c.phase ? t(c.phase) : '—'}</td>
                    {multi && (
                      <td className="p-2">
                        {c.dataset_id
                          ? drivers.find((d) => d.id === c.dataset_id)?.report.input.driver_name
                          : t('allSelected')}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollRegion>
        ) : null,
      )}
      {!!detail.output.unavailable_models?.length && (
        <ul className="list-disc space-y-1 ps-5 text-sm">
          {detail.output.unavailable_models
            .filter((m) => m.model === (multi ? 'multi_driver_weekday' : 'driver_weekday'))
            .map((m) => (
              <li key={m.model}>{t(m.reason)}</li>
            ))}
        </ul>
      )}
      {fit?.status === 'available' && (
        <details className="workspace-panel text-sm">
          <summary className="min-h-11 cursor-pointer md:min-h-0">{t('coefficients')}</summary>
          <p className="my-3 text-xs">{t('formula')}</p>
          {!multi && (
            <dl className="grid gap-3 sm:grid-cols-2">
              {(['slope', 'penalty', 'training_min', 'training_max'] as const).map((k) => (
                <div key={k} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{t(k)}</dt>
                  <dd className="break-all">
                    <bdi>{fit[k]}</bdi>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {multi && (
            <>
              <p>
                {t('penalty')}: <bdi>{fit.penalty}</bdi>
              </p>
              {fit.predictors?.map((p) => (
                <div key={p.dataset_id} className="my-3 rounded-md border p-3">
                  <h4 className="text-subsection-title">
                    {drivers.find((d) => d.id === p.dataset_id)?.report.input.driver_name}
                  </h4>
                  <dl className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {(['slope', 'center', 'scale', 'training_min', 'training_max'] as const).map(
                      (k) => (
                        <div key={k} className="min-w-0">
                          <dt className="text-xs text-muted-foreground">{t(k)}</dt>
                          <dd className="break-all">
                            <bdi>{p[k]}</bdi>
                          </dd>
                        </div>
                      ),
                    )}
                  </dl>
                  {!!p.extrapolated_dates.length && (
                    <p className="mt-2 break-words text-xs">
                      {t('extrapolation')} <bdi>{p.extrapolated_dates.join(', ')}</bdi>
                    </p>
                  )}
                </div>
              ))}
            </>
          )}
          <ol className="mt-3 list-inside list-decimal break-all">
            {fit.weekday_intercepts?.map((value, i) => (
              <li key={i}>
                <bdi>{value}</bdi>
              </li>
            ))}
          </ol>
          {!!fit.extrapolated_dates?.length && (
            <p className="mt-3 text-xs">
              {t('extrapolation')} <bdi>{fit.extrapolated_dates.join(', ')}</bdi>
            </p>
          )}
        </details>
      )}
      {drivers.map((d) => (
        <details key={d.id} className="workspace-panel text-sm">
          <summary className="min-h-11 cursor-pointer md:min-h-0">
            {t('capturedDataset')}
            {multi ? ` · ${d.report.input.driver_name}` : ''}
          </summary>
          <NextIntlClientProvider messages={{ ExternalDrivers: messages.ExternalDrivers }}>
            <ExternalDriverReport report={d.report} />
          </NextIntlClientProvider>
        </details>
      ))}
    </section>
  )
}
