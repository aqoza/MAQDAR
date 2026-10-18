import { getTranslations } from 'next-intl/server'
import {
  ChartNoAxesColumnIncreasing,
  DollarSign,
  EyeOff,
  Layers,
  TriangleAlert,
} from 'lucide-react'
import { availability } from '@/lib/dashboard'
import type { DashboardKpis } from '@/lib/dashboard-locations'
import { DashboardValuation } from './dashboard-valuation'

export async function DashboardMetrics({
  summary,
  locale,
}: {
  summary: DashboardKpis
  locale: string
}) {
  const t = await getTranslations('Dashboard')
  const number = new Intl.NumberFormat(locale)
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 })
  const ratio = availability(summary.available_pairs, summary.observed_pairs)
  const metrics = [
    {
      key: 'availability',
      label: 'stockAvailability',
      icon: Layers,
      tone: 'green',
      value: ratio === null ? t('unavailable') : percent.format(ratio),
      note: t('compactMetricCounts', {
        available: summary.available_pairs,
        observed: summary.observed_pairs,
      }),
    },
    {
      key: 'value',
      label: 'value',
      icon: DollarSign,
      tone: 'green',
      value: null,
      note: t('valueCompactNote'),
    },
    {
      key: 'stockOuts',
      label: 'stockOuts',
      icon: TriangleAlert,
      tone: 'red',
      value: number.format(summary.stock_outs),
      note: t('stockOutsCompactNote'),
    },
    {
      key: 'coverage',
      label: 'coverage',
      icon: ChartNoAxesColumnIncreasing,
      tone: 'green',
      value: number.format(summary.observed_pairs),
      note: t('coverageCompactNote'),
    },
    {
      key: 'missing',
      label: 'missing',
      icon: EyeOff,
      tone: 'blue',
      value: number.format(summary.unobserved_pairs),
      note: t('missingCompactNote'),
    },
  ] as const
  return (
    <div className="dashboard-metrics" aria-label={t('metrics')}>
      {metrics.map(({ key, label, icon: Icon, tone, value, note }) => (
        <section className="dashboard-metric" key={key} aria-label={t(key)}>
          <span className={`dashboard-icon dashboard-icon-${tone}`}>
            <Icon aria-hidden="true" />
          </span>
          <div className="dashboard-metric-body">
            <h2 aria-label={t(key)}>{t(label)}</h2>
            {key === 'value' ? (
              <DashboardValuation
                values={summary.inventory_value}
                locale={locale}
                label={t('currency')}
                allLabel={t('allCurrencyTotals')}
                unavailable={t('unavailable')}
              />
            ) : (
              <div className="dashboard-metric-line">
                <p
                  className="dashboard-metric-value"
                  data-unavailable={key === 'availability' && ratio === null ? '' : undefined}
                >
                  {value}
                </p>
                <span
                  className="dashboard-trend"
                  title={t('trendUnavailable')}
                  aria-label={t('trendUnavailable')}
                >
                  —
                </span>
              </div>
            )}
            <p className="dashboard-metric-note">{note}</p>
          </div>
        </section>
      ))}
    </div>
  )
}
