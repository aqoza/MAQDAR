'use client'

import { useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useFormatter, useLocale, useTranslations } from 'next-intl'
import {
  ArrowRight,
  CircleAlert,
  ListChecks,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react'
import {
  actionCategories,
  filterPlannerActions,
  type ActionFact,
  type PlannerAction,
  type PlannerActionData,
} from '@/lib/planner-actions'
import { formatCostDecimal, formatPurchaseCost } from '@/lib/purchase-costs'
import { formatDateOnly } from '@/lib/format'
import type { ALL_FORECAST_MODELS } from '@/lib/forecasting'
import { Button } from '@/components/ui/button'
import styles from './planner-action-centre.module.css'

const sourceLinks = {
  stock: '/forecasts/workbench',
  purchase: '/replenishment/review?status=pending',
  transfer: '/replenishment/redistribution/review?status=pending',
  forecast: '/forecasts?tab=quality',
  handoff: '/replenishment/review?status=approved',
}

export function PlannerActionCentre({ data }: { data: PlannerActionData }) {
  const t = useTranslations('PlannerActions')
  const stock = useTranslations('StockComparison')
  const models = useTranslations('Forecasting')
  const format = useFormatter()
  const locale = useLocale()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [category, setCategory] = useState<(typeof actionCategories)[number]>('all')
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState('')
  const [selection, setSelection] = useState<string | null>(null)
  const detail = useRef<HTMLElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const locations = [
    ...new Set(
      data.actions.flatMap((action) => [
        action.location,
        ...(action.sourceLocation ? [action.sourceLocation] : []),
      ]),
    ),
  ].sort()
  const visible = filterPlannerActions(data.actions, category, location, query)
  const selected = visible.find((action) => action.id === selection) ?? visible[0]
  const failed = data.sources.filter((source) => source.failed)
  const allFailed = data.sources.length > 0 && failed.length === data.sources.length
  const filtered = Boolean(query || location || category !== 'all')
  const title = (action: PlannerAction) =>
    action.kind === 'stock' && action.status
      ? t(`stockTitles.${action.status}`)
      : t(`titles.${action.kind}`)
  const reset = () => {
    setCategory('all')
    setQuery('')
    setLocation('')
    setSelection(null)
  }
  const refresh = () => startTransition(() => router.refresh())
  const dateTime = (value: string) =>
    format.dateTime(new Date(value), { dateStyle: 'medium', timeStyle: 'short' })
  function value(fact: ActionFact) {
    if (fact.value === null) return t('unavailable')
    if (fact.format === 'date') return formatDateOnly(format, fact.value)
    if (fact.format === 'basis')
      return fact.value === 'approved' ? t('approvedBasis') : t('calculatedBasis')
    if (fact.format === 'model')
      return models(`models.${fact.value as (typeof ALL_FORECAST_MODELS)[number]}`)
    if (fact.format === 'money')
      return formatPurchaseCost(fact.value, fact.currency ?? null, fact.digits ?? null, locale)
    if (fact.label === 'horizon') return t('days', { count: Number(fact.value) })
    if (fact.format === 'quantity')
      return `${formatCostDecimal(fact.value, locale)} ${fact.unit ?? t('unknownUnit')}`
    return fact.value
  }
  function select(action: PlannerAction) {
    setSelection(action.id)
    if (window.matchMedia('(width < 768px)').matches) {
      requestAnimationFrame(() => {
        detail.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
        detail.current?.focus({ preventScroll: true })
      })
    }
  }
  const icons = [ListChecks, CircleAlert, ShieldCheck, ArrowRight]
  return (
    <div className={styles.workspace} data-planner-actions>
      <div className={styles.scope}>
        <span>{t('scope')}</span>
        <span>{t('checked', { time: dateTime(data.checkedAt) })}</span>
      </div>
      {failed.length > 0 && (
        <div className={styles.warning} role="alert">
          <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
          <span>
            {t(allFailed ? 'allFailed' : 'partial', {
              sources: failed.map((source) => t(`sources.${source.source}`)).join(' · '),
            })}
          </span>
        </div>
      )}
      <div className={styles.summary} role="group" aria-label={t('categoriesLabel')}>
        {actionCategories.map((key, index) => {
          const Icon = icons[index]
          return (
            <button
              key={key}
              type="button"
              data-category={key}
              aria-pressed={category === key}
              onClick={() => setCategory(key)}
            >
              <span className={styles.tile} data-category={key}>
                <Icon
                  aria-hidden="true"
                  className={key === 'next' ? 'size-4 rtl:rotate-180' : 'size-4'}
                />
              </span>
              <span>
                <strong className="text-evidence-value">
                  {allFailed
                    ? '—'
                    : format.number(
                        data.actions.filter((action) => key === 'all' || action.category === key)
                          .length,
                      )}
                </strong>
                <span className={styles.caption}>{t(`categories.${key}`)}</span>
              </span>
            </button>
          )
        })}
      </div>
      <div className={styles.toolbar}>
        <label className={styles.search}>
          <span id="planner-search-label">{t('search')}</span>
          <span className={styles.inputWrap}>
            <Search className={styles.searchIcon} aria-hidden="true" />
            <input
              ref={search}
              aria-labelledby="planner-search-label"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              maxLength={100}
              placeholder={t('searchPlaceholder')}
              type="search"
            />
            {query && (
              <button
                type="button"
                aria-label={t('clear')}
                className={styles.clear}
                onClick={() => {
                  setQuery('')
                  search.current?.focus()
                }}
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            )}
          </span>
        </label>
        <label className={styles.location}>
          <span id="planner-location-label">{t('location')}</span>
          <select
            aria-labelledby="planner-location-label"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
          >
            <option value="">{t('allLocations')}</option>
            {locations.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <Button variant="outline" onClick={reset}>
          {t('reset')}
        </Button>
        <Button
          variant="outline"
          onClick={refresh}
          disabled={pending}
          aria-label={t('refresh')}
          title={t('refresh')}
        >
          <RefreshCw aria-hidden="true" className="size-4" />
        </Button>
      </div>
      <p className="sr-only" role="status">
        {pending
          ? t('refreshing')
          : t('count', { shown: visible.length, total: data.actions.length })}
      </p>
      <div className={styles.grid}>
        <section className={styles.queue} aria-labelledby="planner-queue-title" aria-busy={pending}>
          <div className={styles.panelHead}>
            <h2 id="planner-queue-title" className="text-section-title">
              {t('queue')}
            </h2>
            <span className={styles.caption}>
              {t('count', { shown: visible.length, total: data.actions.length })}
            </span>
          </div>
          {visible.length > 0 ? (
            <>
              <div className={styles.columnHead} aria-hidden="true">
                <span>{t('actionColumn')}</span>
                <span>{t('itemColumn')}</span>
                <span>{t('saved')}</span>
              </div>
              <ul className={styles.rows}>
                {visible.map((action) => (
                  <li key={action.id}>
                    <button
                      className={styles.row}
                      type="button"
                      data-action-kind={action.kind}
                      aria-pressed={selected?.id === action.id}
                      onClick={() => select(action)}
                    >
                      <span className={styles.actionCopy}>
                        <span className="font-medium">{title(action)}</span>
                        <span className={styles.caption}>
                          <span className={styles.dot} data-category={action.category} />
                          {t(`sources.${action.kind}`)}
                        </span>
                      </span>
                      <span className={styles.record}>
                        <bdi className="font-medium">{action.item}</bdi>
                        <span className={styles.caption}>
                          <bdi>
                            {action.sourceLocation
                              ? `${action.sourceLocation} → ${action.location}`
                              : action.location}
                          </bdi>
                          {action.name ? ` · ${action.name}` : ''}
                        </span>
                      </span>
                      <span className={styles.age}>
                        <time dateTime={action.timestamp} title={dateTime(action.timestamp)}>
                          {format.dateTime(new Date(action.timestamp), {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </time>
                        <ArrowRight aria-hidden="true" className="size-3 rtl:rotate-180" />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className={styles.empty}>
              <ListChecks
                aria-hidden="true"
                className="mx-auto mb-3 size-5 text-muted-foreground"
              />
              <h3 className="text-subsection-title">
                {t(allFailed ? 'unavailableTitle' : filtered ? 'noMatches' : 'emptyTitle')}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {t(allFailed ? 'unavailableBody' : filtered ? 'noMatchesBody' : 'emptyBody')}
              </p>
              <Button
                className="mt-4"
                variant="outline"
                onClick={allFailed ? refresh : filtered ? reset : refresh}
              >
                {t(filtered && !allFailed ? 'reset' : 'refresh')}
              </Button>
            </div>
          )}
          <div className={styles.queueFoot}>{t('queueFoot')}</div>
        </section>
        {selected && (
          <section
            ref={detail}
            tabIndex={-1}
            className={styles.detail}
            aria-labelledby="planner-detail-title"
          >
            <div className={styles.panelHead}>
              <h2 id="planner-detail-title" className="text-section-title">
                {t('details')}
              </h2>
            </div>
            <div className={styles.detailBody}>
              <span className={styles.badge} data-category={selected.category}>
                {t(`categories.${selected.category}`)}
              </span>
              <p className="mt-2 text-sm">
                <bdi className="text-evidence-value">{selected.item}</bdi>
                {selected.name ? ` · ${selected.name}` : ''}
              </p>
              <p className={`${styles.caption} ${styles.detailLocation}`}>
                <MapPin aria-hidden="true" className="size-4 shrink-0" />
                <bdi>
                  {selected.sourceLocation
                    ? `${selected.sourceLocation} → ${selected.location}`
                    : selected.location}
                </bdi>
              </p>
              <p className={`${styles.caption} my-3`}>
                {selected.kind === 'stock' && selected.status
                  ? stock(`statuses.${selected.status}`)
                  : t(`descriptions.${selected.kind}`)}
              </p>
              <h3 className="text-subsection-title">{t('evidence')}</h3>
              <dl className={styles.facts}>
                {selected.facts.map((fact) => (
                  <div key={fact.label}>
                    <dt>{t(`facts.${fact.label}`)}</dt>
                    <dd>
                      <bdi>{value(fact)}</bdi>
                    </dd>
                  </div>
                ))}
              </dl>
              <p className={styles.caveat}>{t(`caveats.${selected.kind}`)}</p>
              <Link href={selected.href} prefetch={false} className={styles.primary}>
                {t(`actions.${selected.kind}`)}
                <ArrowRight className="size-4 shrink-0 rtl:rotate-180" aria-hidden="true" />
              </Link>
            </div>
            <div className={styles.detailFoot}>{t('workflowFooter')}</div>
          </section>
        )}
      </div>
      <details className={styles.coverage}>
        <summary>{t('coverageTitle')}</summary>
        <p>{t('coverage')}</p>
        <ul>
          {data.sources.map((source) => (
            <li key={source.source}>
              <Link href={sourceLinks[source.source]} prefetch={false}>
                {t(`sources.${source.source}`)}
              </Link>
              <span>
                {t(
                  source.failed
                    ? 'sourceFailed'
                    : source.limited
                      ? 'sourceLimited'
                      : 'sourceLoaded',
                )}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
