import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import Form from 'next/form'
import { HelpDisclosure } from '@/components/help-disclosure'
import { notFound, redirect } from 'next/navigation'
import { DashboardDemandChart } from '@/components/dashboard-demand-chart'
import {
  availability,
  dashboardParams,
  kpiSchema,
  formatInventoryValue,
  reportingDay,
} from '@/lib/dashboard'
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
  const [t, locale, supabase] = await Promise.all([
    getTranslations('Dashboard'),
    getLocale(),
    createClient(),
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
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 })
  const ratio = availability(summary.available_pairs, summary.observed_pairs)
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 })
  const metricClass = 'rounded-xl border bg-card p-5'
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-page-title">{t('title')}</h1>
          <p className="text-muted-foreground">{t('asOf', { date: day })}</p>
        </div>
        <div className="flex gap-4 text-sm underline">
          <Link href="/forecasts/quality">{t('quality')}</Link>
          {context.role && isEditorRole(context.role) && (
            <Link href="/imports">{t('importData')}</Link>
          )}
          {context.role && isAdminRole(context.role) && <Link href="/audit">{t('audit')}</Link>}
        </div>
      </div>
      <Form
        action="/dashboard"
        key={`${day}:${location}`}
        className="flex flex-wrap items-end gap-3"
      >
        <label className="grid gap-1">
          {t('reportingDate')}
          <input
            type="date"
            name="day"
            defaultValue={day}
            max={today}
            required
            className="rounded-md border bg-background p-2"
          />
        </label>
        <label className="grid gap-1">
          {t('locationFilter')}
          <input
            name="location"
            defaultValue={location ?? ''}
            maxLength={64}
            className="rounded-md border bg-background p-2"
          />
        </label>
        <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
          {t('filter')}
        </button>
        <Link href="/dashboard" className="underline">
          {t('reset')}
        </Link>
      </Form>
      <HelpDisclosure label={t('metricDetails')}>
        <p>{t('cohort')}</p>
        <dl className="space-y-2">
          {(['availability', 'value', 'stockOuts', 'coverage', 'missing'] as const).map((key) => (
            <div key={key}>
              <dt className="font-medium text-foreground">{t(key)}</dt>
              <dd>{t(`${key}Note`)}</dd>
            </div>
          ))}
        </dl>
        <p>{t('trendNote')}</p>
      </HelpDisclosure>
      {summary.observed_pairs === 0 && <p className="text-muted-foreground">{t('empty')}</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <section className={metricClass}>
          <h2 className="text-sm text-muted-foreground">{t('availability')}</h2>
          <p className="mt-2 text-metric tabular-nums">
            {ratio === null ? t('unavailable') : percent.format(ratio)}
          </p>
          <p className="mt-2 text-sm">
            {t('availabilityCounts', {
              available: summary.available_pairs,
              observed: summary.observed_pairs,
            })}
          </p>
        </section>
        <section className={metricClass}>
          <h2 className="text-sm text-muted-foreground">{t('value')}</h2>
          {summary.inventory_value.length ? (
            <ul className="mt-2 space-y-1">
              {summary.inventory_value.map((row) => (
                <li key={row.currency} className="text-xl font-semibold tabular-nums">
                  {formatInventoryValue(row.value, row.currency, locale)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-2xl">—</p>
          )}
        </section>
        {(
          [
            ['stockOuts', summary.stock_outs],
            ['coverage', summary.observed_pairs],
            ['missing', summary.unobserved_pairs],
          ] as const
        ).map(([label, value]) => (
          <section key={label} className={metricClass}>
            <h2 className="text-sm text-muted-foreground">{t(label)}</h2>
            <p className="mt-2 text-metric tabular-nums">{number.format(value)}</p>
          </section>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        {t('freshness', {
          stale: summary.stale_pairs,
          oldest: summary.oldest_snapshot ?? t('unavailable'),
        })}
      </p>
      {summary.stale_pairs > 0 && (
        <p role="status" className="rounded-lg border p-3 text-sm">
          {t('stale', { count: summary.stale_pairs })}
        </p>
      )}
      <section className={metricClass}>
        <h2 className="text-section-title">{t('trend')}</h2>
        <DashboardDemandChart
          data={summary.demand}
          locale={locale}
          sold={t('sold')}
          lost={t('lost')}
          label={t('trend')}
        />
        <details className="mt-4">
          <summary className="cursor-pointer text-sm">{t('table')}</summary>
          <table className="mt-3 w-full text-start text-sm">
            <caption className="sr-only">{t('trend')}</caption>
            <thead>
              <tr>
                <th className="text-start">{t('date')}</th>
                <th className="text-end">{t('sold')}</th>
                <th className="text-end">{t('lost')}</th>
              </tr>
            </thead>
            <tbody>
              {summary.demand.map((row) => (
                <tr key={row.date} className="border-t">
                  <td>{row.date}</td>
                  <td className="text-end tabular-nums">
                    {number.format(row.quantity as unknown as number)}
                  </td>
                  <td className="text-end tabular-nums">
                    {number.format(row.lost_sales_quantity as unknown as number)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>
    </div>
  )
}
