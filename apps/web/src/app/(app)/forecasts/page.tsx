import Link from 'next/link'
import type { Metadata } from 'next'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { CancelPlanningRun, PlanningForm, PlanningRefresh } from '@/components/planning-controls'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'
import { reportingDay } from '@/lib/dashboard'
import { isActiveRun, readinessSchema } from '@/lib/planning'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Forecasts')
  return { title: t('title') }
}

export default async function ForecastsPage() {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const organization = context.active
  const [t, db, locale, format] = await Promise.all([
    getTranslations('Planning'),
    createClient(),
    getLocale(),
    getFormatter(),
  ])
  const { data, error } = await db
    .from('planning_runs')
    .select(
      'id,kind,location_id,from_date,to_date,status,attempts,created_at,finished_at,result,locations(code)',
    )
    .eq('organization_id', context.active.id)
    .order('created_at', { ascending: false })
    .order('id')
    .limit(20)
  if (error) throw new Error('Planning history unavailable')
  const active = data.some((run) => isActiveRun(run.status))
  const editor = isEditorRole(context.role)
  const to = reportingDay(new Date(), context.active.effective_time_zone)
  const from = new Date(Date.parse(to) - 364 * 86_400_000).toISOString().slice(0, 10)
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 })
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        <PlanningRefresh active={active} label={t('refresh')} />
      </div>
      <p className="text-sm text-muted-foreground">{t('scope')}</p>
      {editor && !active && (
        <Link href="/forecasts/classify" className="inline-block rounded-md border px-4 py-2">
          {t('classify')}
        </Link>
      )}
      {editor && !active && (
        <Link href="/forecasts/new" className="inline-block rounded-md border px-4 py-2">
          {t('forecast')}
        </Link>
      )}
      {editor && !active && (
        <PlanningForm
          key={organization.id}
          organizationId={context.active.id}
          requestId={crypto.randomUUID()}
          from={from}
          to={to}
          labels={{
            location: t('location'),
            from: t('from'),
            to: t('to'),
            submit: t('submit'),
            pending: t('pending'),
          }}
        />
      )}
      {active && (
        <p role="status" className="rounded-lg border p-3">
          {t('activeNote')}
        </p>
      )}
      {!data.length && <p className="rounded-xl border border-dashed p-6">{t('empty')}</p>}
      <h2 className="text-lg font-semibold">{t('recent')}</h2>
      {data.map((run) => {
        const parsed = readinessSchema.safeParse(run.result)
        const result = run.kind === 'readiness' && parsed.success ? parsed.data : null
        return (
          <article key={run.id} className="space-y-3 rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-semibold">
                {t(`kinds.${run.kind as 'readiness' | 'classification' | 'forecast'}`)} ·{' '}
                {run.locations?.code ?? run.location_id} · {run.from_date} – {run.to_date}
              </h3>
              <span>
                {t(
                  `status.${run.status as 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'}`,
                )}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {t('created', {
                time: format.dateTime(new Date(run.created_at), 'long'),
                attempts: run.attempts,
              })}
            </p>
            {isActiveRun(run.status) && editor && (
              <CancelPlanningRun
                organizationId={organization.id}
                runId={run.id}
                label={t('cancel')}
              />
            )}
            {run.status === 'failed' && <p role="status">{t('failedNote')}</p>}
            {run.status === 'succeeded' && run.kind === 'readiness' && !result && (
              <p role="status">{t('unavailable')}</p>
            )}
            {run.status === 'succeeded' && run.kind === 'classification' && (
              <Link href={`/forecasts/${run.id}`} className="inline-block underline">
                {t('classificationResults')}
              </Link>
            )}
            {run.status === 'succeeded' && run.kind === 'forecast' && (
              <Link href={`/forecasts/results/${run.id}`} className="inline-block underline">
                {t('forecastResults')}
              </Link>
            )}
            {result && (
              <>
                <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {(
                    [
                      'active_items',
                      'items_with_history',
                      'stored_rows',
                      'days_with_records',
                      'positive_demand_rows',
                      'quantity',
                      'lost_sales_quantity',
                    ] as const
                  ).map((key) => (
                    <div key={key}>
                      <dt className="text-sm text-muted-foreground">{t(`metrics.${key}`)}</dt>
                      <dd className="text-xl tabular-nums">
                        {number.format(result[key] as number)}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="text-sm">
                  {result.first_record
                    ? t('range', {
                        from: result.first_record,
                        to: result.last_record ?? result.first_record,
                      })
                    : t('noHistory')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('computed', { time: format.dateTime(new Date(result.computed_at), 'long') })}
                </p>
              </>
            )}
          </article>
        )
      })}
    </div>
  )
}
