import Link from 'next/link'
import type { Metadata } from 'next'
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  CircleCheck,
  Clock,
  Layers,
  ListChecks,
  LockKeyhole,
  MinusCircle,
  Package,
  Search,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react'
import { ForecastHeroIllustration } from '@/components/forecast-illustrations'
import styles from '@/components/forecast-workspace.module.css'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { CancelPlanningRun, PlanningForm, PlanningRefresh } from '@/components/planning-controls'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'
import { reportingDay } from '@/lib/dashboard'
import { isActiveRun, readinessSchema } from '@/lib/planning'

function StatusGlyph({ status }: { status: string }) {
  const Icon =
    status === 'succeeded'
      ? CircleCheck
      : status === 'failed'
        ? AlertCircle
        : status === 'canceled'
          ? MinusCircle
          : Clock
  return <Icon aria-hidden="true" />
}

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
      'id,kind,location_id,from_date,to_date,status,attempts,created_at,finished_at,result,locations(code,name_en,name_ar)',
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
  const canStart = editor && !active
  const tasks = [
    {
      key: 'readiness',
      label: t('submit'),
      href: '#demand-check',
      icon: Search,
      tone: 'violet',
      enabled: canStart,
    },
    {
      key: 'quality',
      label: t('quality'),
      href: '/forecasts/quality',
      icon: BarChart3,
      tone: 'indigo',
      enabled: true,
    },
    {
      key: 'workbench',
      label: t('workbench'),
      href: '/forecasts/workbench',
      icon: ShieldCheck,
      tone: 'blue',
      enabled: true,
    },
    {
      key: 'classify',
      label: t('classify'),
      href: '/forecasts/classify',
      icon: Package,
      tone: 'cyan',
      enabled: canStart,
    },
    {
      key: 'forecast',
      label: t('forecast'),
      href: '/forecasts/new',
      icon: TrendingUp,
      tone: 'green',
      enabled: canStart,
    },
    {
      key: 'prepare',
      label: t('prepare'),
      href: '/forecasts/prepare',
      icon: Layers,
      tone: 'red',
      enabled: canStart,
    },
  ] as const
  return (
    <div className={styles.workspace} data-forecast-workspace>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>{t('workspace.eyebrow')}</p>
          <h1 className="text-page-title">{t('title')}</h1>
          <p>{t('workspace.description')}</p>
        </div>
        <div className={styles.heroArt}>
          <ForecastHeroIllustration />
        </div>
      </header>
      <nav className={styles.taskGrid} aria-label={t('workspace.tools')}>
        {tasks.map(({ key, label, href, icon: Icon, tone, enabled }) => {
          const content = (
            <>
              <span className={`${styles.taskIcon} ${styles[tone]}`}>
                <Icon aria-hidden="true" />
              </span>
              <strong>{label}</strong>
              <span>{t(`workspace.tasks.${key}`)}</span>
            </>
          )
          const className = `${styles.taskCard} ${key === 'readiness' && canStart ? styles.selected : ''}`
          const TaskLink = href.startsWith('#') ? 'a' : Link
          return enabled ? (
            <TaskLink
              key={key}
              href={href}
              className={className}
              aria-label={label}
              aria-current={key === 'readiness' ? 'location' : undefined}
            >
              {content}
            </TaskLink>
          ) : (
            <div key={key} className={className} aria-disabled="true">
              {content}
            </div>
          )
        })}
      </nav>
      <div className={styles.columns}>
        {canStart ? (
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
              locationPlaceholder: t('workspace.locationPlaceholder'),
              readyTitle: t('workspace.readyTitle'),
              readyDescription: t('workspace.readyDescription'),
              start: t('workspace.start'),
              safeNote: t('workspace.safeNote'),
              scope: t('scope'),
            }}
          />
        ) : (
          <section className={styles.readinessPanel} aria-labelledby="workspace-state">
            <span className={styles.stateIcon}>
              {active ? <Clock aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}
            </span>
            <h2 id="workspace-state" className="text-section-title">
              {t(active ? 'workspace.activeTitle' : 'workspace.readOnlyTitle')}
            </h2>
            <p role={active ? 'status' : undefined}>
              {t(active ? 'activeNote' : 'workspace.readOnlyDescription')}
            </p>
            {data.length > 0 && (
              <a href="#run-history" className={styles.resultLink}>
                {t('workspace.inspectRuns')}
                <ArrowRight aria-hidden="true" size={15} />
              </a>
            )}
          </section>
        )}
        <aside className={styles.latest} aria-labelledby="latest-runs-title">
          <div className={styles.panelHeading}>
            <h2 id="latest-runs-title" className="text-section-title">
              {t('workspace.latest')}
            </h2>
            <PlanningRefresh active={active} label={t('refresh')} compact />
          </div>
          {data.length ? (
            <>
              <ul className={styles.latestList}>
                {data.slice(0, 5).map((run) => (
                  <li key={run.id}>
                    <a className={styles.latestLink} href={`#run-${run.id}`}>
                      <span
                        className={styles.statusIcon}
                        data-status={run.status}
                        role="img"
                        aria-label={t(
                          `status.${run.status as 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'}`,
                        )}
                      >
                        <StatusGlyph status={run.status} />
                      </span>
                      <span className={styles.latestText}>
                        <strong>
                          {(locale.startsWith('ar') && run.locations?.name_ar) ||
                            run.locations?.name_en ||
                            run.locations?.code ||
                            run.location_id}
                        </strong>
                        <span>
                          {t(
                            `kinds.${run.kind as 'readiness' | 'classification' | 'forecast' | 'preparation' | 'policy'}`,
                          )}
                          {' · '}
                          <time dateTime={run.created_at}>
                            {format.relativeTime(new Date(run.created_at), new Date())}
                          </time>
                        </span>
                        <span className="block">
                          {run.from_date} – {run.to_date}
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
              <a href="#run-history" className={styles.viewAll}>
                {t('workspace.viewAll', { count: data.length })}
                <ArrowRight aria-hidden="true" />
              </a>
            </>
          ) : (
            <div className={styles.latestEmpty}>
              <ListChecks aria-hidden="true" />
              <p>{t('empty')}</p>
            </div>
          )}
        </aside>
      </div>
      {data.length > 0 && (
        <section id="run-history" className={styles.history} aria-labelledby="run-history-title">
          <div className={styles.panelHeading}>
            <h2 id="run-history-title" className="text-section-title">
              {t('recent')}
            </h2>
            <p className={styles.runMeta}>{t('workspace.historyNote')}</p>
          </div>
          {data.map((run) => {
            const parsed = readinessSchema.safeParse(run.result)
            const result = run.kind === 'readiness' && parsed.success ? parsed.data : null
            return (
              <article key={run.id} id={`run-${run.id}`} className={styles.run}>
                <div className={styles.runHeader}>
                  <h3 className="text-subsection-title">
                    {t(
                      `kinds.${run.kind as 'readiness' | 'classification' | 'forecast' | 'preparation' | 'policy'}`,
                    )}{' '}
                    · {run.locations?.code ?? run.location_id} · {run.from_date} – {run.to_date}
                  </h3>
                  <span className={styles.statusBadge} data-status={run.status}>
                    <StatusGlyph status={run.status} />
                    {t(
                      `status.${run.status as 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'}`,
                    )}
                  </span>
                </div>
                <p className={styles.runMeta}>
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
                {run.status === 'succeeded' && run.kind === 'preparation' && (
                  <Link href={`/forecasts/prepared/${run.id}`} className="inline-block underline">
                    {t('preparationResults')}
                  </Link>
                )}
                {run.status === 'succeeded' && run.kind === 'forecast' && (
                  <Link href={`/forecasts/results/${run.id}`} className="inline-block underline">
                    {t('forecastResults')}
                  </Link>
                )}
                {run.status === 'succeeded' && run.kind === 'policy' && (
                  <Link href={`/forecasts/policies/${run.id}`} className="inline-block underline">
                    {t('policyResults')}
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
                          'positive_demand_rows',
                          'quantity',
                          'lost_sales_quantity',
                        ] as const
                      ).map((key) => (
                        <div key={key}>
                          <dt>{t(`metrics.${key}`)}</dt>
                          <dd>{number.format(result[key] as number)}</dd>
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
                      {t('computed', {
                        time: format.dateTime(new Date(result.computed_at), 'long'),
                      })}
                    </p>
                  </>
                )}
              </article>
            )
          })}
        </section>
      )}
    </div>
  )
}
