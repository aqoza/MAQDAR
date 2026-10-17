import Form from 'next/form'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { StockLocatorHeader } from '@/components/stock-locator-header'
import { ItemCodeInput } from '@/components/master-data/item-code-input'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { reportingDay } from '@/lib/dashboard'
import { displayName, formatDateOnly } from '@/lib/format'
import { formatCostDecimal } from '@/lib/purchase-costs'
import { UNITS_OF_MEASURE } from '@/lib/master-data/schemas'
import { lastPage, type RawSearchParams } from '@/lib/master-data/list-params'
import {
  stockLocatorParams,
  stockLocatorInputSchema,
  stockLocatorResultSchema,
  stockLocatorHref,
  stockLocatorPath,
  type StockLocatorResult,
} from '@/lib/stock-locator'

export async function generateMetadata() {
  const t = await getTranslations('StockLocator')
  return { title: t('title') }
}

export default async function StockLocator({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const [db, t, locale, format, raw] = await Promise.all([
    createClient(),
    getTranslations('StockLocator'),
    getLocale(),
    getFormatter(),
    searchParams,
  ])
  const params = stockLocatorParams(
    raw,
    reportingDay(new Date(), context.active.effective_time_zone),
  )
  const parsed = stockLocatorInputSchema.safeParse(params)
  // Suggestions are bounded; the text field accepts any exact permitted code beyond this list.
  const locations = await db
    .from('locations')
    .select('code,name_en,name_ar')
    .eq('organization_id', context.active.id)
    .eq('is_active', true)
    .order('code')
    .limit(200)
  if (locations.error) throw new Error('Location suggestions unavailable')
  let result: StockLocatorResult | null = null
  let error: 'invalid' | 'unavailable' | 'groupLimit' | null = null
  if (parsed.success) {
    const input = parsed.data
    const response = await db.rpc('stock_locator', {
      p_organization_id: context.active.id,
      p_item_code: input.item,
      p_receiving_code: input.receiving,
      p_unit: input.unit,
      p_day: input.day,
      p_filters: { q: params.q, view: params.view, scope: input.scope },
      p_page: params.page,
      p_size: params.size,
    })
    if (response.error?.code === 'MQ404') error = 'unavailable'
    else if (response.error?.code === 'MQ422')
      error = response.error.hint === 'group_limit' ? 'groupLimit' : 'invalid'
    else if (response.error) throw new Error('Stock locator unavailable')
    else result = stockLocatorResultSchema.parse(response.data)
    if (result && result.page !== params.page) redirect(stockLocatorHref(params, result.page))
  } else if (raw.item !== undefined || raw.receiving !== undefined || raw.unit !== undefined)
    error = 'invalid'
  const inputClass = 'w-full min-w-0 rounded-md border bg-background p-2'
  return (
    <div className="min-w-0 space-y-4">
      <StockLocatorHeader />
      <Form
        action={stockLocatorPath}
        className="workspace-toolbar space-y-3"
        key={JSON.stringify(params)}
      >
        <div className="grid min-w-0 grid-cols-2 gap-3 xl:grid-cols-4">
          <label className="col-span-2 grid min-w-0 gap-1 sm:col-span-1">
            {t('item')}
            <ItemCodeInput
              name="item"
              required
              maxLength={64}
              defaultValue={params.item}
              className={inputClass}
            />
          </label>
          <label className="col-span-2 grid min-w-0 gap-1 sm:col-span-1">
            {t('receiving')}
            <input
              name="receiving"
              required
              maxLength={64}
              defaultValue={params.receiving}
              list="locator-locations"
              className={inputClass}
            />
            <datalist id="locator-locations">
              {locations.data.map((location) => (
                <option key={location.code} value={location.code}>
                  {displayName(location, locale).primary}
                </option>
              ))}
            </datalist>
          </label>
          <label className="grid min-w-0 gap-1">
            {t('unit')}
            <select name="unit" required defaultValue={params.unit} className={inputClass}>
              <option value="">{t('chooseUnit')}</option>
              {UNITS_OF_MEASURE.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 gap-1">
            {t('day')}
            <input
              type="date"
              name="day"
              required
              min="0001-01-01"
              max="9999-12-31"
              defaultValue={params.day}
              className={inputClass}
            />
          </label>
        </div>
        <div className="flex min-w-0 flex-wrap items-end gap-3">
          <label className="grid min-w-0 flex-[1_1_12rem] gap-1">
            {t('scope')}
            <select name="scope" defaultValue={params.scope} className={inputClass}>
              <option value="exact">{t('scopes.exact')}</option>
              <option value="interchangeable">{t('scopes.interchangeable')}</option>
            </select>
          </label>
          <label className="grid min-w-0 flex-[1_1_15rem] gap-1">
            {t('search')}
            <input name="q" maxLength={100} defaultValue={params.q} className={inputClass} />
          </label>
          <label className="grid min-w-0 flex-[1_1_12rem] gap-1">
            {t('view')}
            <select name="view" defaultValue={params.view} className={inputClass}>
              {(['matching', 'other', 'all'] as const).map((view) => (
                <option key={view} value={view}>
                  {t(`views.${view}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            {t('size')}
            <select name="size" defaultValue={params.size} className={inputClass}>
              {[25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
            {t('find')}
          </button>
          <Link href={stockLocatorPath} className="py-2 underline">
            {t('reset')}
          </Link>
        </div>
      </Form>
      {error && <p role="alert">{t(error)}</p>}
      {!result && !error && <p className="text-muted-foreground">{t('start')}</p>}
      {result && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-medium">
                {result.item.code} · {displayName(result.item, locale).primary}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('context', {
                  location: result.receiving.code,
                  day: formatDateOnly(format, result.day),
                  unit: result.unit,
                })}
              </p>
            </div>
            <div>
              <p>{t('counts', result.counts)}</p>
              <p className="text-xs text-muted-foreground">
                {t('checked', { time: format.dateTime(new Date(result.checked_at), 'long') })}
              </p>
            </div>
          </div>
          {result.scope === 'interchangeable' && (
            <p
              className="text-xs text-muted-foreground"
              role={result.relationship_status === 'unit_mismatch' ? 'status' : undefined}
            >
              {result.relationship_status === 'unit_mismatch'
                ? t('catalogMismatch')
                : t('relationshipContext', { count: result.item_count })}
            </p>
          )}
          <TableScrollRegion label={t('results')}>
            <table className="w-full text-sm">
              <caption className="sr-only">{t('caption')}</caption>
              <thead>
                <tr>
                  {(
                    [
                      'source',
                      'stockItem',
                      'stock',
                      'snapshot',
                      'distance',
                      'lane',
                      'evidence',
                    ] as const
                  ).map((key) => (
                    <th key={key} className="p-3 text-start">
                      {t(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={`${row.id}:${row.item.id}`} className="border-t align-top">
                    <th scope="row" className="min-w-40 p-3 text-start font-normal">
                      <p className="max-w-56 break-all font-medium">{row.code}</p>
                      <p className="max-w-56 break-words">{displayName(row, locale).primary}</p>
                      <p className="text-xs text-muted-foreground">
                        {[row.city, row.country_code].filter(Boolean).join(' · ')}
                      </p>
                    </th>
                    <td className="min-w-40 p-3">
                      <p className="max-w-56 break-all font-medium">{row.item.code}</p>
                      <p className="max-w-56 break-words">
                        {displayName(row.item, locale).primary}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t(`matchKinds.${row.match_kind}`)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t('itemStatus', { status: t(`itemStatuses.${row.item.status}`) })}
                      </p>
                    </td>
                    <td className="min-w-44 p-3">
                      <p className="font-medium tabular-nums">
                        {row.snapshot
                          ? `${formatCostDecimal(row.snapshot.net, locale, 3)} ${row.snapshot.unit ?? t('unknownUnit')}`
                          : '—'}
                      </p>
                      <p
                        className={
                          row.status === 'matching'
                            ? 'text-xs font-medium text-primary'
                            : 'text-xs text-muted-foreground'
                        }
                      >
                        {t(`statuses.${row.status}`)}
                      </p>
                    </td>
                    <td className="min-w-32 p-3">
                      {row.snapshot ? (
                        <>
                          <time dateTime={row.snapshot.date}>
                            {formatDateOnly(format, row.snapshot.date)}
                          </time>
                          <p className="text-xs text-muted-foreground">
                            {t('age', { days: row.snapshot.age })}
                          </p>
                        </>
                      ) : (
                        t('noSnapshot')
                      )}
                    </td>
                    <td className="min-w-32 p-3">
                      {row.distance_km === null
                        ? t('unknownDistance')
                        : t('kilometres', {
                            distance: format.number(row.distance_km, { maximumFractionDigits: 1 }),
                          })}
                    </td>
                    <td className="min-w-44 p-3">
                      {row.lane ? (
                        <>
                          <p>{t('p50', { days: row.lane.p50 })}</p>
                          <p className="text-xs text-muted-foreground">
                            {t('p90', { days: row.lane.p90 })}
                          </p>
                        </>
                      ) : (
                        t('noLane')
                      )}
                    </td>
                    <td className="min-w-48 p-3">
                      <details className="max-w-72 break-words text-xs">
                        <summary className="cursor-pointer py-1">{t('inspect')}</summary>
                        <dl className="space-y-2">
                          <div>
                            <dt>{t('catalogUnit')}</dt>
                            <dd>{row.item.unit}</dd>
                            <dd>{format.dateTime(new Date(row.item.updated_at), 'long')}</dd>
                          </div>
                          {row.relationship_path.length > 0 && (
                            <div>
                              <dt>{t('relationshipPath')}</dt>
                              <dd>
                                <ol className="space-y-3">
                                  {row.relationship_path.map((edge) => (
                                    <li key={edge.id}>
                                      <p>
                                        {edge.from_code} ⇄ {edge.to_code}
                                      </p>
                                      <p>
                                        {t('relationshipRatio', {
                                          unit: edge.unit,
                                          priority: edge.priority,
                                        })}
                                      </p>
                                      <p className="break-all">{edge.id}</p>
                                      <p>
                                        {t('relationshipUpdated', {
                                          time: format.dateTime(new Date(edge.updated_at), 'long'),
                                        })}
                                      </p>
                                      <p>
                                        {t('catalogUpdated', {
                                          from: format.dateTime(
                                            new Date(edge.from_updated_at),
                                            'long',
                                          ),
                                          to: format.dateTime(new Date(edge.to_updated_at), 'long'),
                                        })}
                                      </p>
                                    </li>
                                  ))}
                                </ol>
                              </dd>
                            </div>
                          )}
                          {row.snapshot && (
                            <>
                              <div>
                                <dt>{t('onHand')}</dt>
                                <dd>{formatCostDecimal(row.snapshot.quantity, locale, 3)}</dd>
                              </div>
                              <div>
                                <dt>{t('allocated')}</dt>
                                <dd>{formatCostDecimal(row.snapshot.allocated, locale, 3)}</dd>
                              </div>
                              <div>
                                <dt>{t('snapshotId')}</dt>
                                <dd className="break-all">{row.snapshot.id}</dd>
                              </div>
                              <div>
                                <dt>{t('updated')}</dt>
                                <dd>
                                  {format.dateTime(new Date(row.snapshot.updated_at), 'long')}
                                </dd>
                              </div>
                            </>
                          )}
                          <div>
                            <dt>{t('sourceCoordinates')}</dt>
                            <dd>
                              {row.latitude === null || row.longitude === null
                                ? t('unknownDistance')
                                : `${row.latitude}, ${row.longitude}`}
                            </dd>
                          </div>
                          <div>
                            <dt>{t('receivingCoordinates')}</dt>
                            <dd>
                              {result.receiving.latitude === null ||
                              result.receiving.longitude === null
                                ? t('unknownDistance')
                                : `${result.receiving.latitude}, ${result.receiving.longitude}`}
                            </dd>
                          </div>
                          {row.lane && (
                            <div>
                              <dt>{t('laneId')}</dt>
                              <dd className="break-all">{row.lane.id}</dd>
                              <dd>{format.dateTime(new Date(row.lane.updated_at), 'long')}</dd>
                            </div>
                          )}
                        </dl>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollRegion>
          {!result.rows.length && <p>{t('empty')}</p>}
          <nav className="flex flex-wrap items-center gap-4" aria-label={t('pagination')}>
            {result.page > 1 && (
              <Link
                href={stockLocatorHref(params, result.page - 1)}
                prefetch={false}
                className="py-1 underline"
              >
                {t('previous')}
              </Link>
            )}
            <span>
              {t('page', {
                page: result.page,
                pages: lastPage(result.total, result.size),
                count: result.total,
              })}
            </span>
            {result.page < lastPage(result.total, result.size) && (
              <Link
                href={stockLocatorHref(params, result.page + 1)}
                prefetch={false}
                className="py-1 underline"
              >
                {t('next')}
              </Link>
            )}
          </nav>
        </>
      )}
    </div>
  )
}
