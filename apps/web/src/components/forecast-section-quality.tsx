import { HelpDisclosure } from '@/components/help-disclosure'
import { PageHeader } from '@/components/page-header'
import Form from 'next/form'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { FORECAST_MODELS, FORECAST_STATUSES } from '@/lib/forecasting'
import {
  FORECAST_METHODS,
  formatCoverage,
  formatScore,
  qualityParams,
  qualityRowSchema,
  qualitySpec,
} from '@/lib/forecast-quality'
import {
  lastPage,
  listHref,
  nearestRange,
  toRange,
  PAGE_SIZES,
  type RawSearchParams,
} from '@/lib/master-data/list-params'
import { searchPatterns } from '@/lib/master-data/search'

export async function ForecastQuality({
  searchParams,
  embedded = false,
}: {
  embedded?: boolean
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const params = qualityParams(await searchParams)
  const organizationId = context.active.id
  const [db, t, forecasting, locale] = await Promise.all([
    createClient(),
    getTranslations('ForecastQuality'),
    getTranslations('Forecasting'),
    getLocale(),
  ])
  const query = (head: boolean) => {
    let q = db
      .from('forecast_quality')
      .select('*', { count: 'exact', head })
      .eq('organization_id', organizationId)
    for (const pattern of searchPatterns(params.q)) q = q.like('search_text', pattern)
    if (params.filters.location) q = q.eq('location_code', params.filters.location)
    if (params.filters.status) q = q.eq('status', params.filters.status)
    if (params.filters.model) q = q.eq('model', params.filters.model)
    if (params.filters.method) q = q.eq('method', params.filters.method)
    return q
  }
  const count = await query(true)
  if (count.error) throw new Error('Forecast quality unavailable')
  const total = count.count ?? 0
  const pages = lastPage(total, params.size)
  const href = (page: number) => listHref('/forecasts/quality', qualitySpec, params, { page })
  if (params.page > pages) redirect(href(pages))
  const { from, to } = toRange(params.page, params.size)
  const range = nearestRange(from, to, total)
  const ascending = params.dir === 'asc'
  const result = await query(false)
    .order('finished_at', { ascending: range.reversed ? !ascending : ascending })
    .order('id', { ascending: !range.reversed })
    .range(range.from, range.to)
  if (result.error?.code === 'PGRST103') redirect(href(1))
  if (result.error) throw new Error('Forecast quality unavailable')
  const rows = (range.reversed ? (result.data ?? []).toReversed() : (result.data ?? [])).map(
    (row) => qualityRowSchema.parse(row),
  )
  const inputClass = 'w-full min-w-0 max-w-full rounded-md border bg-background p-2'
  const amount = (value: string | null | undefined) => formatScore(value, locale)
  return (
    <div className="space-y-4">
      {!embedded && (
        <div className="flex gap-4 text-sm underline">
          <Link href="/dashboard">{t('dashboard')}</Link>
          <Link href="/forecasts">{t('planning')}</Link>
        </div>
      )}
      <PageHeader
        title={t('title')}
        description={t('context')}
        help={
          <HelpDisclosure label={t('aboutScores')}>
            <p>{t('description')}</p>
            <p>{t('scoreNote')}</p>
          </HelpDisclosure>
        }
      />
      <Form
        action="/forecasts/quality"
        className="workspace-toolbar flex flex-wrap items-end gap-3"
        key={JSON.stringify(params)}
      >
        <label className="grid min-w-0 max-w-full gap-1">
          {t('search')}
          <input name="q" defaultValue={params.q} maxLength={100} className={inputClass} />
        </label>
        <label className="grid min-w-0 max-w-full gap-1">
          {t('location')}
          <input
            name="location"
            defaultValue={params.filters.location ?? ''}
            maxLength={64}
            className={inputClass}
          />
        </label>
        <label className="grid min-w-0 max-w-full gap-1">
          {t('result')}
          <select name="status" defaultValue={params.filters.status ?? ''} className={inputClass}>
            <option value="">{t('all')}</option>
            {FORECAST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {forecasting(`statuses.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 max-w-full gap-1">
          {t('model')}
          <select name="model" defaultValue={params.filters.model ?? ''} className={inputClass}>
            <option value="">{t('all')}</option>
            {FORECAST_MODELS.map((s) => (
              <option key={s} value={s}>
                {forecasting(`models.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 max-w-full gap-1">
          {t('method')}
          <select name="method" defaultValue={params.filters.method ?? ''} className={inputClass}>
            <option value="">{t('all')}</option>
            {FORECAST_METHODS.map((s) => (
              <option key={s} value={s}>
                {t(`methods.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 max-w-full gap-1">
          {t('size')}
          <select name="size" defaultValue={params.size} className={inputClass}>
            {PAGE_SIZES.map((size) => (
              <option key={size}>{size}</option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 max-w-full gap-1">
          {t('order')}
          <select name="dir" defaultValue={params.dir} className={inputClass}>
            <option value="desc">{t('newest')}</option>
            <option value="asc">{t('oldest')}</option>
          </select>
        </label>
        <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
          {t('filter')}
        </button>
        <Link href="/forecasts/quality">{t('reset')}</Link>
      </Form>
      <p>{t('count', { total })}</p>
      <TableScrollRegion label={t('title')}>
        <table className="w-full text-sm">
          <caption className="sr-only">{t('title')}</caption>
          <thead>
            <tr>
              {(
                [
                  'item',
                  'location',
                  'window',
                  'model',
                  'result',
                  'rmse',
                  'mae',
                  'bias',
                  'evidence',
                ] as const
              ).map((k) => (
                <th className="p-2 text-start" key={k}>
                  {t(k)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t align-top">
                <th className="p-2 text-start">
                  <Link
                    prefetch={false}
                    href={`/forecasts/results/${row.run_id}?item=${row.item_id}`}
                    className="underline"
                  >
                    {row.item_code}
                  </Link>
                  <p className="font-normal">{row.item_name}</p>
                </th>
                <td className="p-2">{row.location_code}</td>
                <td className="p-2">
                  <p>
                    {row.from_date} – {row.to_date}
                  </p>
                  <p>{t('horizon', { days: row.horizon })}</p>
                  <p>{t(`methods.${row.method}`)}</p>
                </td>
                <td className="p-2">{row.model ? forecasting(`models.${row.model}`) : '—'}</td>
                <td className="p-2">{forecasting(`statuses.${row.status}`)}</td>
                <td className="p-2 tabular-nums">{amount(row.rmse)}</td>
                <td className="p-2 tabular-nums">{amount(row.mae)}</td>
                <td className="p-2 tabular-nums">{amount(row.bias)}</td>
                <td className="min-w-72 p-2">
                  <details>
                    <summary className="cursor-pointer">
                      {t('inspect', { item: row.item_code })}
                    </summary>
                    <p className="mt-2">
                      {row.comparison === 'fixed-group-v1'
                        ? t('fixedGroup', { unit: row.unit ?? '—' })
                        : row.unit
                          ? t('individualUnit', { unit: row.unit })
                          : t('individual')}
                    </p>
                    <h2 className="text-section-title mt-3">{t('folds')}</h2>
                    {row.folds.length ? (
                      <ol className="space-y-2">
                        {row.folds.map((fold) => (
                          <li key={fold.test_from}>{t('fold', { ...fold })}</li>
                        ))}
                      </ol>
                    ) : (
                      <p>{t('unavailable')}</p>
                    )}
                    <h2 className="text-section-title mt-3">{t('coverage')}</h2>
                    <p>{t('coverageNote')}</p>
                    <p>{t(`coverageStatuses.${row.evaluation.status}`)}</p>
                    {row.evaluation.status === 'available' && (
                      <>
                        <p>
                          {t('evaluationModel', {
                            model: row.evaluation.model
                              ? forecasting(`models.${row.evaluation.model}`)
                              : '—',
                          })}
                        </p>
                        <p>
                          {t('evaluationWindow', {
                            train: row.evaluation.train_to ?? '—',
                            from: row.evaluation.test_from ?? '—',
                            to: row.evaluation.test_to ?? '—',
                            count: row.evaluation.count ?? '—',
                          })}
                        </p>
                        <p>
                          {t('coverageValues', {
                            lower: formatCoverage(row.evaluation.coverage80, locale),
                            upper: formatCoverage(row.evaluation.coverage95, locale),
                          })}
                        </p>
                      </>
                    )}
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
      {!rows.length && <p>{t('empty')}</p>}
      <nav aria-label={t('pagination')} className="flex gap-4">
        {params.page > 1 && (
          <Link href={href(params.page - 1)} className="underline">
            {t('previous')}
          </Link>
        )}
        <span>{t('page', { page: params.page, pages })}</span>
        {params.page < pages && (
          <Link href={href(params.page + 1)} className="underline">
            {t('next')}
          </Link>
        )}
      </nav>
    </div>
  )
}
