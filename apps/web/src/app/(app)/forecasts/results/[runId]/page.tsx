import { PageHeader } from '@/components/page-header'
import Link from 'next/link'
import { HelpDisclosure } from '@/components/help-disclosure'
import { DemandUnitEvidence } from '@/components/demand-unit-evidence'
import { DriverForecastDetails } from '@/components/driver-forecast-details'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { PreparedForecastDetails } from '@/components/prepared-forecast-details'
import { InventoryPolicyForm } from '@/components/inventory-policy-form'
import { isEditorRole } from '@/lib/auth/roles'
import {
  forecastReadEvidenceSchema as forecastEvidenceSchema,
  forecastReadSummarySchema as forecastSummarySchema,
  ALL_FORECAST_MODELS as FORECAST_MODELS,
  FORECAST_STATUSES,
} from '@/lib/forecasting'

export default async function ForecastResults({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>
  searchParams: Promise<{ item?: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { runId } = await params
  const { item } = await searchParams
  if (!z.guid().safeParse(runId).success || (item && !z.guid().safeParse(item).success)) notFound()
  const [db, t, locale] = await Promise.all([
    createClient(),
    getTranslations('Forecasting'),
    getLocale(),
  ])
  const { data: run, error: runError } = await db
    .from('planning_runs')
    .select('kind,status,from_date,to_date,options,locations(code)')
    .eq('organization_id', context.active.id)
    .eq('id', runId)
    .maybeSingle()
  if (runError) throw new Error('Forecast run unavailable')
  if (!run || run.kind !== 'forecast') notFound()
  if (run.status !== 'succeeded') redirect('/forecasts')
  const expanded = z.object({ method: z.literal('expanded-v1') }).safeParse(run.options).success
  const regional = z.object({ method: z.literal('regional-v1') }).safeParse(run.options).success
  const multi = z.object({ method: z.literal('multi-driver-v1') }).safeParse(run.options).success
  const driver =
    multi || z.object({ method: z.literal('driver-v1') }).safeParse(run.options).success
  const driverText = await getTranslations(multi ? 'MultiDriverForecast' : 'DriverForecast')
  const events = await getTranslations('PlannedEvents')
  const prepared = await getTranslations('PreparedForecast')
  const { data: rows, error } = await db
    .from('forecast_results')
    .select('id,item_id,item_code,item_name,status,model,summary')
    .eq('organization_id', context.active.id)
    .eq('run_id', runId)
    .order('item_code')
    .order('item_id')
    .limit(100)
  if (error) throw new Error('Forecast results unavailable')
  const selected = rows?.find((row) => row.item_id === item)
  const messages = await getMessages()
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 })
  // Intl accepts decimal strings at runtime, retaining precision beyond binary floats.
  const format = (value: string | number | null) =>
    value === null ? '—' : formatter.format(value as number)
  let detail: z.infer<typeof forecastEvidenceSchema> | null = null
  if (item) {
    const { data, error: detailError } = await db
      .from('forecast_results')
      .select('evidence')
      .eq('organization_id', context.active.id)
      .eq('run_id', runId)
      .eq('item_id', item)
      .maybeSingle()
    if (detailError) throw new Error('Forecast evidence unavailable')
    if (!data) notFound()
    const parsed = forecastEvidenceSchema.safeParse(data.evidence)
    if (!parsed.success) throw new Error('Invalid forecast evidence')
    detail = parsed.data
  }
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="forecasts"
        back={
          <Link href="/forecasts" className="text-sm underline">
            {t('back')}
          </Link>
        }
        title={t('results')}
        description={
          <>
            {run.locations?.code} · {run.from_date} – {run.to_date}
          </>
        }
        help={
          <HelpDisclosure label={regional ? prepared('comparisonLabel') : undefined}>
            <p>
              {driver
                ? driverText('method')
                : regional
                  ? prepared('method')
                  : t(expanded ? 'expandedMethod' : 'method')}
            </p>
            {regional && <p>{prepared('comparisonNote')}</p>}
          </HelpDisclosure>
        }
      />

      <div className="workspace-table overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('results')}</caption>
          <thead className="text-xs [&_th]:font-medium">
            <tr>
              {(
                ['item', 'status', 'model', 'total', 'rmse', 'mae', 'bias', 'details'] as const
              ).map((k) => (
                <th key={k} className="p-2 text-start">
                  {t(k)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows?.map((row) => {
              const parsed = forecastSummarySchema.safeParse(row.summary)
              if (!parsed.success) throw new Error('Invalid forecast summary')
              const score = parsed.data.scores.find((s) => s.model === row.model)
              return (
                <tr key={row.item_id} className="border-t">
                  <td className="p-2">
                    {row.item_code}
                    <div className="text-muted-foreground">{row.item_name}</div>
                  </td>
                  <td className="p-2">
                    {t(`statuses.${row.status as (typeof FORECAST_STATUSES)[number]}`)}
                  </td>
                  <td className="p-2">
                    {row.model ? t(`models.${row.model as (typeof FORECAST_MODELS)[number]}`) : '—'}
                  </td>
                  {[
                    parsed.data.total,
                    score?.rmse ?? null,
                    score?.mae ?? null,
                    score?.bias ?? null,
                  ].map((value, i) => (
                    <td key={i} className="p-2 tabular-nums">
                      {format(value)}
                    </td>
                  ))}
                  <td className="p-2">
                    <Link
                      className="underline"
                      href={`/forecasts/results/${runId}?item=${row.item_id}`}
                    >
                      {t('inspect', { code: row.item_code })}
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {detail && (
        <section className="space-y-4" aria-label={t('details')}>
          <h2 className="text-section-title">
            {t('details')} · {rows?.find((r) => r.item_id === item)?.item_code}
          </h2>
          {!driver && selected?.status === 'selected' && isEditorRole(context.role) && (
            <NextIntlClientProvider messages={{ InventoryPolicy: messages.InventoryPolicy }}>
              <InventoryPolicyForm
                key={selected.id}
                organizationId={context.active.id}
                forecastId={selected.id}
                requestId={crypto.randomUUID()}
                horizon={detail.output.forecast.length}
              />
            </NextIntlClientProvider>
          )}
          {!driver && selected && (
            <div className="flex flex-wrap gap-4">
              {isEditorRole(context.role) && (
                <Link className="underline" href={`/forecasts/events/new?forecast=${selected.id}`}>
                  {events('new')}
                </Link>
              )}
              <Link className="underline" href={`/forecasts/events?forecast=${selected.id}`}>
                {events('history')}
              </Link>
            </div>
          )}
          <p className="text-xs">
            {t('observed', { from: detail.source.start_day, to: detail.source.end_day })}
          </p>
          {driver && <DriverForecastDetails detail={detail} />}
          {!detail.source.preparation && (
            <DemandUnitEvidence evidence={detail.source.unit_provenance} />
          )}
          {detail.source.preparation ? (
            <PreparedForecastDetails detail={detail} locale={locale} />
          ) : (
            <p className="text-xs">
              {t('lifecycle', {
                from: detail.source.introduced_on ?? '—',
                to: detail.source.discontinued_on ?? '—',
              })}
            </p>
          )}
          {detail.output.status !== 'selected' && (
            <p>
              {t(`statuses.${detail.output.status}`)}.{' '}
              {detail.output.status === 'insufficient' && t('insufficientNote')}
            </p>
          )}
          {!!detail.output.scores.length && (
            <>
              {!!detail.output.unavailable_models?.length && (
                <p>
                  {t('unavailableModels', {
                    models: detail.output.unavailable_models
                      .map((m) => t(`models.${m.model}`))
                      .join(', '),
                  })}
                </p>
              )}
              <h3 className="text-subsection-title">{t('comparison')}</h3>
              <HelpDisclosure>
                <p className="text-xs">{t('scoreNote')}</p>
              </HelpDisclosure>
              <div className="workspace-table overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">{t('comparison')}</caption>
                  <thead className="text-xs [&_th]:font-medium">
                    <tr>
                      {(['model', 'rmse', 'mae', 'bias'] as const).map((k) => (
                        <th key={k} className="p-2 text-start">
                          {t(k)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detail.output.scores.map((score) => (
                      <tr key={score.model} className="border-t">
                        <td className="p-2">
                          {t(`models.${score.model}`)}
                          {score.model === detail?.output.model ? ` · ${t('winner')}` : ''}
                        </td>
                        {(['rmse', 'mae', 'bias'] as const).map((k) => (
                          <td key={k} className="p-2 tabular-nums">
                            {format(score[k])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details>
                <summary className="min-h-11 cursor-pointer md:min-h-0">{t('folds')}</summary>
                {detail.output.folds.map((fold, i) => (
                  <div key={fold.test_from} className="my-3 space-y-1 rounded-md border p-3">
                    <p className="text-xs">
                      {t('foldWindow', {
                        number: i + 1,
                        trainFrom: fold.train_from,
                        trainTo: fold.train_to,
                        testFrom: fold.test_from,
                        testTo: fold.test_to,
                      })}
                    </p>
                    {detail?.output.scores.map((score) => (
                      <p key={score.model} className="text-sm">
                        {t(`models.${score.model}`)} · {t('rmse')}: {format(score.folds[i].rmse)} ·{' '}
                        {t('mae')}: {format(score.folds[i].mae)} · {t('bias')}:{' '}
                        {format(score.folds[i].bias)}
                      </p>
                    ))}
                  </div>
                ))}
              </details>
              <h3 className="text-subsection-title">{t('daily')}</h3>
              {detail.output.uncertainty && (
                <div className="space-y-2">
                  <h3 className="text-subsection-title">{t('uncertainty')}</h3>
                  <HelpDisclosure>
                    <p className="text-xs">{t('uncertaintyNote')}</p>
                  </HelpDisclosure>
                  <p>{t(`uncertaintyStatuses.${detail.output.uncertainty.status}`)}</p>
                  {detail.output.uncertainty.residual_count !== undefined && (
                    <p className="text-xs">
                      {t('calibrationCount', { count: detail.output.uncertainty.residual_count })}
                    </p>
                  )}
                </div>
              )}
              <TableScrollRegion label={t('daily')}>
                <table className="w-full text-sm">
                  <caption className="sr-only">{t('daily')}</caption>
                  <thead className="text-xs [&_th]:font-medium">
                    <tr>
                      <th className="p-2 text-start">{t('date')}</th>
                      <th className="p-2 text-start">{t('quantity')}</th>
                      {detail.output.uncertainty?.status === 'available' &&
                        (['lower80', 'upper80', 'lower95', 'upper95'] as const).map((key) => (
                          <th key={key} className="p-2 text-start">
                            {t(key)}
                          </th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detail.output.forecast.map((p, index) => (
                      <tr key={p.date} className="border-t">
                        <td className="whitespace-nowrap p-2">
                          <bdi>{p.date}</bdi>
                        </td>
                        <td className="p-2 tabular-nums">{format(p.quantity)}</td>
                        {detail.output.uncertainty?.status === 'available' &&
                          (['lower80', 'upper80', 'lower95', 'upper95'] as const).map((key) => (
                            <td key={key} className="p-2 tabular-nums">
                              {format(detail.output.uncertainty?.bands[index]?.[key] ?? null)}
                            </td>
                          ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScrollRegion>
              {detail.output.evaluation && (
                <section className="space-y-2" aria-label={t('coverage')}>
                  <h3 className="text-subsection-title">{t('coverage')}</h3>
                  <HelpDisclosure>
                    <p className="text-xs">{t('coverageNote')}</p>
                  </HelpDisclosure>
                  <p>{t(`evaluationStatuses.${detail.output.evaluation.status}`)}</p>
                  {detail.output.evaluation.status === 'available' &&
                    detail.output.evaluation.model && (
                      <>
                        <p className="text-xs">
                          {t('coverageWindow', {
                            model: t(`models.${detail.output.evaluation.model}`),
                            train: detail.output.evaluation.train_to ?? '',
                            from: detail.output.evaluation.test_from ?? '',
                            to: detail.output.evaluation.test_to ?? '',
                            count: detail.output.evaluation.count ?? 0,
                            calibration: detail.output.evaluation.calibration ?? 0,
                          })}
                        </p>
                        <p>
                          {t('coverageValues', {
                            level80: format(Number(detail.output.evaluation.coverage80) * 100),
                            level95: format(Number(detail.output.evaluation.coverage95) * 100),
                          })}
                        </p>
                      </>
                    )}
                </section>
              )}
            </>
          )}
          <details>
            <summary className="min-h-11 cursor-pointer md:min-h-0">{t('source')}</summary>
            <p className="my-2 text-xs">{regional ? prepared('sourceNote') : t('sourceNote')}</p>
            <TableScrollRegion label={t('source')}>
              <table className="w-full text-sm">
                <caption className="sr-only">{t('source')}</caption>
                <thead className="text-xs [&_th]:font-medium">
                  <tr>
                    {(['date', 'sold', 'lost'] as const).map((k) => (
                      <th key={k} className="p-2 text-start">
                        {t(k)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {detail.source.demand.map(([day, sold, lost]) => (
                    <tr key={day} className="border-t">
                      <td className="p-2">{day}</td>
                      <td className="p-2 tabular-nums">{format(sold)}</td>
                      <td className="p-2 tabular-nums">{format(lost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScrollRegion>
          </details>
        </section>
      )}
    </div>
  )
}
