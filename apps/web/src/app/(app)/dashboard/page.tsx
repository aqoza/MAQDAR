import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { DashboardDemandChart } from '@/components/dashboard-demand-chart'
import { dashboardSchema, formatInventoryValue, reportingDay } from '@/lib/dashboard'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { isAdminRole, isEditorRole } from '@/lib/auth/roles'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Dashboard')
  return { title: t('title') }
}

export default async function DashboardPage() {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const [t, locale, supabase] = await Promise.all([
    getTranslations('Dashboard'),
    getLocale(),
    createClient(),
  ])
  const day = reportingDay(new Date(), context.active.effective_time_zone)
  const { data, error } = await supabase.rpc('dashboard_summary', {
    p_organization_id: context.active.id,
    p_day: day,
  })
  const parsed = dashboardSchema.safeParse(data)
  if (error || !parsed.success) throw new Error('Dashboard data unavailable')
  const summary = parsed.data
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 })
  const metricClass = 'rounded-xl border bg-card p-5'
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('asOf', { date: day })}</p>
        </div>
        <div className="flex gap-4 text-sm underline">
          {context.role && isEditorRole(context.role) && (
            <Link href="/imports">{t('importData')}</Link>
          )}
          {context.role && isAdminRole(context.role) && <Link href="/audit">{t('audit')}</Link>}
        </div>
      </div>
      {summary.observed_pairs === 0 && (
        <p className="rounded-xl border border-dashed p-6">{t('empty')}</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          <p className="mt-2 text-xs text-muted-foreground">{t('valueNote')}</p>
        </section>
        {(
          [
            ['stockOuts', summary.stock_outs, 'stockOutsNote'],
            ['coverage', summary.observed_pairs, 'coverageNote'],
            ['missing', summary.unobserved_pairs, 'missingNote'],
          ] as const
        ).map(([label, value, note]) => (
          <section key={label} className={metricClass}>
            <h2 className="text-sm text-muted-foreground">{t(label)}</h2>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{number.format(value)}</p>
            <p className="mt-2 text-xs text-muted-foreground">{t(note)}</p>
          </section>
        ))}
      </div>
      {summary.stale_pairs > 0 && (
        <p role="status" className="rounded-lg border p-3 text-sm">
          {t('stale', { count: summary.stale_pairs })}
        </p>
      )}
      <section className={metricClass}>
        <h2 className="text-lg font-semibold">{t('trend')}</h2>
        <p className="mb-6 text-sm text-muted-foreground">{t('trendNote')}</p>
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
