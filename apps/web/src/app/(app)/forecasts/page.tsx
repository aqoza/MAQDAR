import Link from 'next/link'
import type { Metadata } from 'next'
import { Clock, LockKeyhole } from 'lucide-react'
import { ForecastTabs } from '@/components/forecast-tabs'
import { PageHeaderArt } from '@/components/page-header-art'
import { ForecastQuality } from '@/components/forecast-section-quality'
import { PolicyWorkbench } from '@/components/forecast-section-workbench'
import { ClassifyPage } from '@/components/forecast-section-classify'
import { NewForecastPage } from '@/components/forecast-section-new'
import { PreparePage } from '@/components/forecast-section-prepare'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { CancelPlanningRun, PlanningForm } from '@/components/planning-controls'
import { ForecastRunBrowser } from '@/components/forecast-run-browser'
import { HelpDisclosure } from '@/components/help-disclosure'
import styles from '@/components/forecast-workspace.module.css'
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
      'id,kind,options,location_id,from_date,to_date,status,attempts,created_at,finished_at,result,locations(code,name_en,name_ar)',
    )
    .eq('organization_id', organization.id)
    .order('created_at', { ascending: false })
    .order('id')
    .limit(20)
  if (error) throw new Error('Planning history unavailable')
  const active = data.some((run) => isActiveRun(run.status))
  const editor = isEditorRole(context.role)
  const to = reportingDay(new Date(), organization.effective_time_zone)
  const from = new Date(Date.parse(to) - 364 * 86_400_000).toISOString().slice(0, 10)
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 })
  const canStart = editor && !active
  const drivers = await getTranslations('ExternalDrivers')
  const quality = await getTranslations('ForecastQuality')
  const statuses = (['queued', 'running', 'succeeded', 'failed', 'canceled'] as const).map(
    (value) => ({ value, label: t(`status.${value}`) }),
  )
  const now = new Date()
  const runs = data.map((run) => {
    const parsed = readinessSchema.safeParse(run.result)
    const result =
      run.status === 'succeeded' && run.kind === 'readiness' && parsed.success ? parsed.data : null
    const location =
      (locale.startsWith('ar') && run.locations?.name_ar) ||
      run.locations?.name_en ||
      run.locations?.code ||
      run.location_id
    const method =
      run.options && typeof run.options === 'object' && !Array.isArray(run.options)
        ? run.options.method
        : null
    const kind =
      run.kind === 'forecast' && (method === 'driver-v1' || method === 'multi-driver-v1')
        ? quality(`methods.${method}`)
        : t(
            `kinds.${run.kind as 'readiness' | 'classification' | 'forecast' | 'preparation' | 'policy' | 'simulation'}`,
          )
    const resultLink =
      run.kind === 'classification'
        ? { href: `/forecasts/${run.id}`, label: t('classificationResults') }
        : run.kind === 'preparation'
          ? { href: `/forecasts/prepared/${run.id}`, label: t('preparationResults') }
          : run.kind === 'forecast'
            ? { href: `/forecasts/results/${run.id}`, label: t('forecastResults') }
            : run.kind === 'policy'
              ? { href: `/forecasts/policies/${run.id}`, label: t('policyResults') }
              : run.kind === 'simulation'
                ? { href: `/forecasts/simulations/${run.id}`, label: t('simulationResults') }
                : null
    return {
      id: run.id,
      location,
      code: run.locations?.code ?? run.location_id,
      kind,
      status: run.status,
      statusLabel: t(
        `status.${run.status as 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'}`,
      ),
      window: `${run.from_date} – ${run.to_date}`,
      requested: format.relativeTime(new Date(run.created_at), now),
      requestedAt: run.created_at,
      inspectLabel: t('workspace.inspectRun', {
        location,
        kind,
        time: format.dateTime(new Date(run.created_at), 'long'),
      }),
      evidence: (
        <>
          {isActiveRun(run.status) && editor && (
            <CancelPlanningRun
              organizationId={organization.id}
              runId={run.id}
              label={t('cancel')}
            />
          )}
          {run.status === 'failed' && (
            <p role="status" className={styles.failedNote}>
              {t('failedNote')}
            </p>
          )}
          {run.status === 'canceled' && <p>{t('workspace.canceledNote')}</p>}
          {run.status === 'succeeded' && run.kind === 'readiness' && !result && (
            <p role="status">{t('unavailable')}</p>
          )}
          {run.status === 'succeeded' && resultLink && (
            <Link href={resultLink.href} className={styles.resultLink}>
              {resultLink.label}
            </Link>
          )}
          {result && (
            <>
              <dl className={styles.metrics}>
                {(
                  [
                    'active_items',
                    'items_with_history',
                    'stored_rows',
                    'days_with_records',
                  ] as const
                ).map((key) => (
                  <div key={key}>
                    <dt>{t(`metrics.${key}`)}</dt>
                    <dd>{number.format(result[key])}</dd>
                  </div>
                ))}
              </dl>
              {!result.first_record && <p>{t('noHistory')}</p>}
            </>
          )}
          <details className={styles.moreEvidence}>
            <summary>{t('workspace.moreEvidence')}</summary>
            {result && (
              <>
                <dl className={styles.metrics}>
                  {(['positive_demand_rows', 'quantity', 'lost_sales_quantity'] as const).map(
                    (key) => (
                      <div key={key}>
                        <dt>{t(`metrics.${key}`)}</dt>
                        <dd>{number.format(result[key] as number)}</dd>
                      </div>
                    ),
                  )}
                </dl>
                {result.first_record && (
                  <p>
                    {t('range', {
                      from: result.first_record,
                      to: result.last_record ?? result.first_record,
                    })}
                  </p>
                )}
                <p className={styles.runMeta}>
                  {t('computed', { time: format.dateTime(new Date(result.computed_at), 'long') })}
                </p>
              </>
            )}
            <p className={styles.runMeta}>
              {t('created', {
                time: format.dateTime(new Date(run.created_at), 'long'),
                attempts: run.attempts,
              })}
            </p>
            <p className={styles.runId}>{t('workspace.runId', { id: run.id })}</p>
          </details>
          <p className={styles.runMeta}>{t('workspace.savedNote')}</p>
        </>
      ),
    }
  })
  return (
    <div className={styles.workspace} data-forecast-workspace>
      <ForecastTabs
        header={
          <>
            <PageHeaderArt pattern="forecasts" />
            <header className={styles.heading}>
              <h1 className="self-start text-page-title">{t('title')}</h1>
              <div className={`${styles.method} flex flex-wrap items-start gap-x-3`}>
                <Link
                  href="/forecasts/drivers"
                  className="inline-flex min-h-11 items-center text-sm underline"
                >
                  {drivers('title')}
                </Link>
                <HelpDisclosure>
                  <p>{t('scope')}</p>
                </HelpDisclosure>
              </div>
            </header>
          </>
        }
        label={t('workspace.tools')}
        tabs={[
          { key: 'readiness', label: t('submit') },
          { key: 'quality', label: t('quality') },
          { key: 'workbench', label: t('workbench') },
          { key: 'classify', label: t('classify') },
          { key: 'forecast', label: t('forecast') },
          { key: 'prepare', label: t('prepare') },
        ]}
        panels={[
          <div key="readiness">
            {canStart ? (
              <PlanningForm
                key={`readiness-${organization.id}`}
                organizationId={organization.id}
                requestId={crypto.randomUUID()}
                from={from}
                to={to}
                labels={{
                  location: t('location'),
                  from: t('from'),
                  to: t('to'),
                  submit: t('submit'),
                  pending: t('pending'),
                  locationPlaceholder: t('workspace.locationPlaceholder'),
                }}
              />
            ) : (
              <section className={styles.notice} aria-labelledby="workspace-state">
                {active ? <Clock aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}
                <div>
                  <h2 id="workspace-state" className="text-section-title">
                    {t(active ? 'workspace.activeTitle' : 'workspace.readOnlyTitle')}
                  </h2>
                  <p role={active ? 'status' : undefined}>
                    {t(active ? 'activeNote' : 'workspace.readOnlyDescription')}
                  </p>
                </div>
              </section>
            )}
            <ForecastRunBrowser
              key={`history-${organization.id}`}
              runs={runs}
              active={active}
              statuses={statuses}
              labels={{
                recent: t('recent'),
                details: t('workspace.details'),
                search: t('workspace.search'),
                status: t('workspace.status'),
                allStatuses: t('workspace.allStatuses'),
                location: t('workspace.locationRun'),
                window: t('workspace.window'),
                requested: t('workspace.requested'),
                empty: t('empty'),
                noMatch: t('workspace.noMatch'),
                reset: t('workspace.reset'),
                selectRun: t('workspace.selectRun'),
                refresh: t('refresh'),
                historyNote: t('workspace.historyNote'),
              }}
            />
          </div>,
          <ForecastQuality key="quality" embedded searchParams={Promise.resolve({})} />,
          <PolicyWorkbench key="workbench" embedded searchParams={Promise.resolve({})} />,
          editor ? (
            <ClassifyPage key="classify" embedded />
          ) : (
            <p key="classify">{t('workspace.readOnlyDescription')}</p>
          ),
          editor ? (
            <NewForecastPage key="new" embedded />
          ) : (
            <p key="new">{t('workspace.readOnlyDescription')}</p>
          ),
          editor ? (
            <PreparePage key="prepare" embedded />
          ) : (
            <p key="prepare">{t('workspace.readOnlyDescription')}</p>
          ),
        ]}
      />
    </div>
  )
}
