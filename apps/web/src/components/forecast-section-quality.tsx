import { HelpDisclosure } from '@/components/help-disclosure'
import { PageHeader } from '@/components/page-header'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { X } from 'lucide-react'
import {
  ForecastQualityDisplay,
  ForecastQualityFilters,
} from '@/components/forecast-quality-filters'
import { ForecastQualityTable } from '@/components/forecast-quality-table'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { ALL_FORECAST_MODELS as FORECAST_MODELS, FORECAST_STATUSES } from '@/lib/forecasting'
import {
  FORECAST_METHODS,
  formatCoverage,
  formatScore,
  qualityParams,
  qualityRowSchema,
} from '@/lib/forecast-quality'
import { forecastQualityHref, forecastQualityResetHref } from '@/lib/forecast-quality-navigation'
import {
  isFiltered,
  lastPage,
  nearestRange,
  toRange,
  type RawSearchParams,
} from '@/lib/master-data/list-params'
import { searchPatterns } from '@/lib/master-data/search'
import styles from './forecast-quality.module.css'

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
  const href = (page: number) => forecastQualityHref(params, { page }, embedded)
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
  const filtered = isFiltered(params)
  const advancedCount =
    Number(Boolean(params.filters.model)) + Number(Boolean(params.filters.method))
  const applied = [
    ...(params.q
      ? [
          {
            label: t('search'),
            value: params.q,
            href: forecastQualityHref(params, { q: '' }, embedded),
          },
        ]
      : []),
    ...Object.entries(params.filters).map(([key, value]) => ({
      label: t(key === 'status' ? 'result' : (key as 'location' | 'model' | 'method')),
      value:
        key === 'model'
          ? forecasting(`models.${value as (typeof FORECAST_MODELS)[number]}`)
          : key === 'status'
            ? forecasting(`statuses.${value as (typeof FORECAST_STATUSES)[number]}`)
            : key === 'method'
              ? t(`methods.${value as (typeof FORECAST_METHODS)[number]}`)
              : value,
      href: forecastQualityHref(params, { filters: { [key]: null } }, embedded),
    })),
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        pattern={embedded ? undefined : 'forecasts'}
        title={t('title')}
        description={t('context')}
        help={
          <HelpDisclosure label={t('aboutScores')}>
            <p>{t('description')}</p>
            <p>{t('scoreNote')}</p>
          </HelpDisclosure>
        }
        back={
          !embedded && (
            <div className="flex gap-4 text-sm underline">
              <Link href="/dashboard">{t('dashboard')}</Link>
              <Link href="/forecasts">{t('planning')}</Link>
            </div>
          )
        }
      />
      <ForecastQualityFilters
        key={`filters-${JSON.stringify(params)}`}
        params={params}
        embedded={embedded}
        labels={{
          search: t('search'),
          searchPlaceholder: t('searchPlaceholder'),
          clearSearch: t('clearSearch'),
          location: t('location'),
          locationPlaceholder: t('locationPlaceholder'),
          result: t('result'),
          all: t('all'),
          filter: t('filter'),
          reset: t('reset'),
          searchScope: t('searchScope'),
          moreFilters: t('moreFilters'),
          activeFilters: t('activeFilters', { count: advancedCount }),
          model: t('model'),
          method: t('method'),
        }}
        statuses={FORECAST_STATUSES.map((value) => ({
          value,
          label: forecasting(`statuses.${value}`),
        }))}
        models={FORECAST_MODELS.map((value) => ({ value, label: forecasting(`models.${value}`) }))}
        methods={FORECAST_METHODS.map((value) => ({ value, label: t(`methods.${value}`) }))}
      />
      <div className={styles.resultsBar}>
        <div className={styles.chips}>
          <p role="status">{t('count', { total })}</p>
          {applied.map((chip) => (
            <Link
              key={chip.label}
              href={chip.href}
              className={styles.chip}
              aria-label={t('removeFilter', { filter: chip.label })}
            >
              <span>
                {chip.label}: {chip.value}
              </span>
              <X aria-hidden="true" />
            </Link>
          ))}
        </div>
        <ForecastQualityDisplay
          key={`display-${JSON.stringify(params)}`}
          params={params}
          embedded={embedded}
          labels={{
            displaySettings: t('displaySettings'),
            size: t('size'),
            order: t('order'),
            newest: t('newest'),
            oldest: t('oldest'),
            updateDisplay: t('updateDisplay'),
          }}
        />
      </div>
      {rows.length > 0 ? (
        <ForecastQualityTable
          key={`table-${JSON.stringify(params)}`}
          label={t('title')}
          columns={(
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
          ).map((key) => t(key))}
          records={rows.map((row) => ({
            id: row.id,
            itemCode: row.item_code,
            itemName: row.item_name,
            href: `/forecasts/results/${row.run_id}?item=${row.item_id}`,
            location: row.location_code,
            window: (
              <div className="text-xs text-muted-foreground">
                <p>
                  {row.from_date} – {row.to_date}
                </p>
                <p>{t('horizon', { days: row.horizon })}</p>
                <p>{t(`methods.${row.method}`)}</p>
              </div>
            ),
            model: row.model ? forecasting(`models.${row.model}`) : '—',
            result: forecasting(`statuses.${row.status}`),
            rmse: formatScore(row.rmse, locale),
            mae: formatScore(row.mae, locale),
            bias: formatScore(row.bias, locale),
            inspectLabel: t('inspect', { item: row.item_code }),
            hideLabel: t('hideEvidence', { item: row.item_code }),
            evidence: (
              <div className={styles.evidenceGrid}>
                <section>
                  <h3 className="text-subsection-title">{t('folds')}</h3>
                  <div className={`${styles.evidenceNotes} mt-2`}>
                    <p>
                      {row.comparison === 'fixed-group-v1'
                        ? t('fixedGroup', { unit: row.unit ?? '—' })
                        : row.unit
                          ? t('individualUnit', { unit: row.unit })
                          : t('individual')}
                    </p>
                    {row.folds.length ? (
                      <ol className="space-y-2">
                        {row.folds.map((fold) => (
                          <li key={fold.test_from}>{t('fold', { ...fold })}</li>
                        ))}
                      </ol>
                    ) : (
                      <p>{t('unavailable')}</p>
                    )}
                  </div>
                </section>
                <section>
                  <h3 className="text-subsection-title">{t('coverage')}</h3>
                  <div className={`${styles.evidenceNotes} mt-2`}>
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
                  </div>
                </section>
              </div>
            ),
          }))}
        />
      ) : (
        <div className={styles.empty}>
          <p className="text-subsection-title">{filtered ? t('noMatches') : t('empty')}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {filtered ? t('noMatchesHint') : t('emptyHint')}
          </p>
          {filtered && (
            <Link href={forecastQualityResetHref(embedded)} className={`${styles.reset} mt-2`}>
              {t('reset')}
            </Link>
          )}
        </div>
      )}
      <nav aria-label={t('pagination')} className="flex flex-wrap items-center gap-4 text-xs">
        {params.page > 1 && (
          <Link href={href(params.page - 1)} className={styles.reset}>
            {t('previous')}
          </Link>
        )}
        <span>{t('page', { page: params.page, pages })}</span>
        {params.page < pages && (
          <Link href={href(params.page + 1)} className={styles.reset}>
            {t('next')}
          </Link>
        )}
      </nav>
    </div>
  )
}
