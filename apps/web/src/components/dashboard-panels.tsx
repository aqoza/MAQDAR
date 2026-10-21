import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import {
  ArrowRight,
  ArrowUpRight,
  Box,
  ChevronRight,
  CircleDot,
  EyeOff,
  MapPin,
  Rocket,
  Sparkles,
  TrendingUp,
  TriangleAlert,
} from 'lucide-react'
import { availability } from '@/lib/dashboard'
import {
  dashboardLocationHref,
  type DashboardKpis,
  type LocationAvailability,
} from '@/lib/dashboard-locations'
import { DashboardArt } from './dashboard-art'

export async function DashboardLocationPanel({
  rows,
  day,
  locale,
  unavailable,
}: {
  rows: LocationAvailability[]
  day: string
  locale: string
  unavailable: boolean
}) {
  const t = await getTranslations('Dashboard')
  const number = new Intl.NumberFormat(locale)
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 })
  return (
    <section className="dashboard-panel dashboard-locations" aria-labelledby="location-title">
      <div className="dashboard-panel-heading">
        <h2 id="location-title">
          <MapPin aria-hidden="true" />
          {t('byLocation')}
        </h2>
        <Link
          href="/locations"
          prefetch={false}
          title={t('locationCatalog')}
          aria-label={t('locationCatalog')}
        >
          {t('locationsLink')}
          <ArrowRight aria-hidden="true" />
        </Link>
      </div>
      <div
        className="dashboard-table-scroll"
        tabIndex={0}
        role="region"
        aria-label={t('byLocation')}
      >
        <table className="dashboard-location-table">
          <caption className="sr-only">{t('locationPreview')}</caption>
          <thead>
            <tr>
              <th>{t('location')}</th>
              <th>{t('stockAvailability')}</th>
              <th>{t('availableObserved')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ location, summary }) => {
              const ratio = summary
                ? availability(summary.available_pairs, summary.observed_pairs)
                : null
              const name = locale.startsWith('ar')
                ? (location.name_ar ?? location.name_en)
                : location.name_en
              return (
                <tr key={location.code}>
                  <td>
                    <Link
                      href={dashboardLocationHref(day, location.code)}
                      prefetch={false}
                      title={`${location.code} – ${name}`}
                    >
                      {location.code}
                      {name !== location.code ? ` – ${name}` : ''}
                    </Link>
                  </td>
                  <td>
                    <div className="dashboard-availability">
                      <span className="dashboard-bar" aria-hidden="true">
                        <span style={{ inlineSize: `${(ratio ?? 0) * 100}%` }} />
                      </span>
                      <span>{ratio === null ? '—' : percent.format(ratio)}</span>
                    </div>
                  </td>
                  <td
                    title={
                      summary
                        ? t('locationCoverage', {
                            missing: summary.unobserved_pairs,
                            stale: summary.stale_pairs,
                          })
                        : t('locationUnavailable')
                    }
                  >
                    {summary ? (
                      <details className="dashboard-row-coverage">
                        <summary>{`${number.format(summary.available_pairs)} / ${number.format(summary.observed_pairs)}`}</summary>
                        <span className="dashboard-coverage-note">
                          {t('locationCoverage', {
                            missing: summary.unobserved_pairs,
                            stale: summary.stale_pairs,
                          })}
                        </span>
                      </details>
                    ) : (
                      t('unavailable')
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!rows.length && (
          <p className="dashboard-panel-empty">
            {unavailable ? t('locationUnavailable') : t('noLocations')}
          </p>
        )}
      </div>
    </section>
  )
}

export async function DashboardRiskPanel() {
  const t = await getTranslations('Dashboard')
  return (
    <section className="dashboard-panel dashboard-risk" aria-labelledby="risk-title">
      <div className="dashboard-panel-heading">
        <h2 id="risk-title">
          <Box aria-hidden="true" />
          {t('riskTitle')}
        </h2>
        <span className="dashboard-unavailable-label">{t('unavailable')}</span>
      </div>
      <div
        className="dashboard-table-scroll"
        tabIndex={0}
        role="region"
        aria-label={t('riskTitle')}
      >
        <table>
          <caption className="sr-only">{t('riskTitle')}</caption>
          <thead>
            <tr>
              {(['item', 'location', 'onHand', 'forecast30', 'daysLeft'] as const).map((key) => (
                <th key={key}>{t(key)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={5}>
                <div className="dashboard-risk-empty">
                  <span className="dashboard-icon dashboard-icon-orange">
                    <TriangleAlert aria-hidden="true" />
                  </span>
                  <strong>{t('riskUnavailable')}</strong>
                  <p>{t('riskDependency')}</p>
                  <Link href="/forecasts/workbench" prefetch={false}>
                    {t('reviewPolicies')}
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

export async function DashboardInsights({ summary }: { summary: DashboardKpis }) {
  const t = await getTranslations('Dashboard')
  const insights = [
    {
      icon: TrendingUp,
      tone: 'green',
      title: t('availabilityFact'),
      description: t('compactCounts', {
        available: summary.available_pairs,
        observed: summary.observed_pairs,
      }),
      href: '#location-title',
    },
    {
      icon: TriangleAlert,
      tone: 'orange',
      title: t('stockOutFact', { count: summary.stock_outs }),
      description: t('stockOutInsight'),
      href: '#risk-title',
    },
    {
      icon: EyeOff,
      tone: 'blue',
      title: t('missingFact', { count: summary.unobserved_pairs }),
      description: t('missingInsight'),
      href: '#dashboard-definitions',
    },
    {
      icon: CircleDot,
      tone: 'blue',
      title: t('freshnessTitle'),
      description: t('freshnessCompact', {
        stale: summary.stale_pairs,
        oldest: summary.oldest_snapshot ?? t('unavailable'),
      }),
      href: '#dashboard-definitions',
    },
  ]
  return (
    <section className="dashboard-panel dashboard-insights" aria-labelledby="insights-title">
      <div className="dashboard-panel-heading">
        <h2 id="insights-title">
          <Sparkles aria-hidden="true" />
          {t('insights')}
        </h2>
        <Link href="/forecasts">
          {t('planningLink')}
          <ArrowRight aria-hidden="true" />
        </Link>
      </div>
      <ul>
        {insights.map(({ icon: Icon, tone, title, description, href }) => (
          <li key={title}>
            <a href={href}>
              <span className={`dashboard-icon dashboard-icon-${tone}`}>
                <Icon aria-hidden="true" />
              </span>
              <span>
                <strong>{title}</strong>
                <span>{description}</span>
              </span>
              <ChevronRight className="dashboard-insight-chevron" aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

export async function DashboardInformation({ qualityHref }: { qualityHref: string }) {
  const t = await getTranslations('Dashboard')
  return (
    <Link className="dashboard-information" href={qualityHref} prefetch={false}>
      <DashboardArt className="dashboard-information-art" />
      <span className="dashboard-icon dashboard-icon-green">
        <Rocket aria-hidden="true" />
      </span>
      <span>
        <strong>{t('informationTitle')}</strong>
        <span>{t('informationDescription')}</span>
      </span>
      <ArrowUpRight aria-hidden="true" />
    </Link>
  )
}
