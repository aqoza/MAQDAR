import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import Form from 'next/form'
import { notFound, redirect } from 'next/navigation'
import {
  Bell,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  ChevronDown,
  FileText,
  ListFilter,
  ListChecks,
  MapPin,
  Upload,
} from 'lucide-react'
import { DashboardDemandChart } from '@/components/dashboard-demand-chart'
import { DashboardMetrics } from '@/components/dashboard-metrics'
import {
  DashboardInsights,
  DashboardInformation,
  DashboardLocationPanel,
  DashboardRiskPanel,
} from '@/components/dashboard-panels'
import { DashboardArt } from '@/components/dashboard-art'
import { dashboardParams, kpiSchema, reportingDay } from '@/lib/dashboard'
import { loadDashboardLocations } from '@/lib/dashboard-locations'
import type { RawSearchParams } from '@/lib/master-data/list-params'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { isAdminRole, isEditorRole } from '@/lib/auth/roles'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Dashboard')
  return { title: t('title') }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const [t, locale, supabase, actionsText] = await Promise.all([
    getTranslations('Dashboard'),
    getLocale(),
    createClient(),
    getTranslations('PlannerActions'),
  ])
  const today = reportingDay(new Date(), context.active.effective_time_zone)
  const { day, location } = dashboardParams(await searchParams, today)
  const { data, error } = await supabase.rpc('dashboard_kpis', {
    p_organization_id: context.active.id,
    p_day: day,
    ...(location ? { p_location_code: location } : {}),
  })
  if (error?.code === 'MQ404') notFound()
  const parsed = kpiSchema.safeParse(data)
  if (error || !parsed.success) throw new Error('Dashboard data unavailable')
  const summary = parsed.data
  const qualityHref = summary.location_code
    ? `/forecasts/quality?${new URLSearchParams({ location: summary.location_code })}`
    : '/forecasts/quality'
  const locations = await loadDashboardLocations(supabase, context.active.id, summary, data)
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 })
  const date = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const range = [summary.demand[0]?.date, day]
    .map((value) => (value ? date.format(new Date(`${value}T00:00:00Z`)) : '—'))
    .join(' – ')
  return (
    <div data-dashboard className="dashboard-workspace">
      <div className="dashboard-actions">
        <Link href="/dashboard/actions" prefetch={false}>
          <ListChecks aria-hidden="true" />
          {actionsText('navTitle')}
        </Link>
        <Link href={qualityHref} prefetch={false}>
          <ChartNoAxesColumnIncreasing aria-hidden="true" />
          {t('quality')}
        </Link>
        {context.role && isEditorRole(context.role) && (
          <Link href="/imports" prefetch={false}>
            <Upload aria-hidden="true" />
            {t('importData')}
          </Link>
        )}
        {context.role && isAdminRole(context.role) && (
          <Link href="/audit" prefetch={false}>
            <FileText aria-hidden="true" />
            {t('audit')}
          </Link>
        )}
        <button
          type="button"
          className="dashboard-bell"
          disabled
          title={t('notificationsUnavailable')}
          aria-label={t('notificationsUnavailable')}
        >
          <Bell aria-hidden="true" />
        </button>
      </div>
      <div className="dashboard-hero">
        <DashboardArt className="dashboard-hero-art" />
        <div>
          <h1>{t('title')}</h1>
          <p>{t('asOf', { date: day })}</p>
        </div>
        <p className="dashboard-tagline">
          {t('taglineLine1')}
          <br />
          {t('taglineLine2')}
          <br />
          {t('taglineLine3')}
        </p>
      </div>
      <Form
        action="/dashboard"
        prefetch={false}
        key={`${day}:${location}`}
        className="dashboard-filters"
      >
        <label>
          <span>{t('reportingDate')}</span>
          <span className="dashboard-field">
            <CalendarDays aria-hidden="true" />
            <input
              id="dashboard-reporting-date"
              type="date"
              name="day"
              defaultValue={day}
              max={today}
              required
            />
          </span>
        </label>
        <label>
          <span>{t('locationLabel')}</span>
          <span className="dashboard-field">
            <MapPin aria-hidden="true" />
            <input
              name="location"
              aria-label={t('locationFilter')}
              defaultValue={location ?? ''}
              maxLength={64}
              list="dashboard-location-options"
              placeholder={t('allLocations')}
              autoComplete="off"
            />
            <ChevronDown aria-hidden="true" />
          </span>
        </label>
        <datalist id="dashboard-location-options">
          {locations.suggestions.map((row) => (
            <option value={row.code} key={row.code}>
              {locale.startsWith('ar') ? (row.name_ar ?? row.name_en) : row.name_en}
            </option>
          ))}
        </datalist>
        <button type="submit" className="dashboard-apply">
          <ListFilter aria-hidden="true" />
          {t('filter')}
        </button>
        <Link href="/dashboard" prefetch={false} className="dashboard-reset">
          {t('reset')}
        </Link>
      </Form>
      {locations.limited && <p className="dashboard-notice">{t('limitedSuggestions')}</p>}
      {summary.observed_pairs === 0 && <p className="dashboard-notice">{t('empty')}</p>}
      {summary.stale_pairs > 0 && (
        <p className="dashboard-notice" role="status">
          {t('stale', { count: summary.stale_pairs })}
        </p>
      )}
      <DashboardMetrics summary={summary} locale={locale} />
      <div className="dashboard-grid">
        <div className="dashboard-main-column">
          <section className="dashboard-panel dashboard-demand" aria-labelledby="demand-title">
            <div className="dashboard-chart-heading">
              <h2 id="demand-title">{t('trend')}</h2>
              <div>
                <span>{range}</span>
                <a href="#dashboard-reporting-date" aria-label={t('changeReportingDate')}>
                  <CalendarDays aria-hidden="true" />
                </a>
                <span className="dashboard-period">{t('last30Days')}</span>
              </div>
            </div>
            <DashboardDemandChart
              data={summary.demand}
              locale={locale}
              sold={t('sold')}
              lost={t('lost')}
              label={t('trend')}
              units={t('units')}
            />
          </section>
          <div className="dashboard-bottom-grid">
            <DashboardLocationPanel
              rows={locations.rows}
              day={day}
              locale={locale}
              unavailable={locations.unavailable}
            />
            <DashboardRiskPanel />
          </div>
        </div>
        <aside className="dashboard-side-column">
          <DashboardInsights summary={summary} />
          <DashboardInformation qualityHref={qualityHref} />
        </aside>
      </div>
      <div className="dashboard-details">
        <details id="dashboard-definitions">
          <summary>{t('metricDetails')}</summary>
          <p>{t('cohort')}</p>
          <dl>
            {(['availability', 'value', 'stockOuts', 'coverage', 'missing'] as const).map((key) => (
              <div key={key}>
                <dt>{t(key)}</dt>
                <dd>{t(`${key}Note`)}</dd>
              </div>
            ))}
          </dl>
          <p>{t('trendUnavailable')}</p>
          <p>{t('riskDependency')}</p>
        </details>
        <details>
          <summary>{t('table')}</summary>
          <p>{t('trendNote')}</p>
          <div
            className="dashboard-table-scroll"
            role="region"
            aria-label={t('table')}
            tabIndex={0}
          >
            <table>
              <caption className="sr-only">{t('trend')}</caption>
              <thead>
                <tr>
                  <th>{t('date')}</th>
                  <th>{t('sold')}</th>
                  <th>{t('lost')}</th>
                </tr>
              </thead>
              <tbody>
                {summary.demand.map((row) => (
                  <tr key={row.date}>
                    <td>{row.date}</td>
                    <td>{number.format(row.quantity as unknown as number)}</td>
                    <td>{number.format(row.lost_sales_quantity as unknown as number)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </div>
  )
}
