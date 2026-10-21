import { HelpDisclosure } from '@/components/help-disclosure'
import { PageHeader } from '@/components/page-header'
import { ForecastFilterSearchInput } from '@/components/forecast-filter-search-input'
import { ForecastFilterForm } from '@/components/forecast-filter-form'
import { LocationCodeInput } from '@/components/master-data/location-code-input'
import Form from 'next/form'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { POLICY_STATUSES } from '@/lib/inventory-policy'
import { REVIEW_STATUSES, workbenchParams, workbenchRowSchema } from '@/lib/policy-workbench'
import {
  forecastWorkbenchHref,
  forecastWorkbenchResetHref,
} from '@/lib/forecast-workbench-navigation'
import {
  lastPage,
  nearestRange,
  toRange,
  type RawSearchParams,
} from '@/lib/master-data/list-params'
import { searchPatterns } from '@/lib/master-data/search'

export async function PolicyWorkbench({
  searchParams,
  embedded = false,
}: {
  embedded?: boolean
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const params = workbenchParams(await searchParams)
  const [db, t, policy, locale, search] = await Promise.all([
    createClient(),
    getTranslations('PolicyWorkbench'),
    getTranslations('InventoryPolicy'),
    getLocale(),
    getTranslations('ForecastSearch'),
  ])
  const organizationId = context.active.id
  const query = (head: boolean) => {
    let q = db
      .from('policy_workbench')
      .select('*', { count: 'exact', head })
      .eq('organization_id', organizationId)
    for (const pattern of searchPatterns(params.q)) q = q.like('search_text', pattern)
    if (params.filters.location) q = q.eq('location_code', params.filters.location)
    if (params.filters.status) q = q.eq('status', params.filters.status)
    if (params.filters.review) q = q.eq('review_status', params.filters.review)
    return q
  }
  const count = await query(true)
  if (count.error) throw new Error('Policy workbench unavailable')
  const total = count.count ?? 0
  const pages = lastPage(total, params.size)
  const href = (page: number) => forecastWorkbenchHref(params, { page }, embedded)
  if (params.page > pages) redirect(href(pages))
  const { from, to } = toRange(params.page, params.size)
  const range = nearestRange(from, to, total)
  const ascending = params.dir === 'asc'
  const result = await query(false)
    .order('finished_at', { ascending: range.reversed ? !ascending : ascending })
    .order('id', { ascending: !range.reversed })
    .range(range.from, range.to)
  if (result.error?.code === 'PGRST103') redirect(href(1))
  if (result.error) throw new Error('Policy workbench unavailable')
  const rows = (range.reversed ? (result.data ?? []).toReversed() : (result.data ?? [])).map(
    (row) => workbenchRowSchema.parse(row),
  )
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 })
  const amount = (value: string | null) =>
    value === null ? '—' : number.format(value as unknown as number)
  return (
    <div className="space-y-4">
      <PageHeader
        pattern={embedded ? undefined : 'forecasts'}
        title={t('title')}
        description={t('context')}
        actions={
          <>
            {!embedded && (
              <Link href="/forecasts" className="text-sm underline">
                {t('planning')}
              </Link>
            )}
            <Link href="/forecasts/simulations" className="underline">
              {t('simulations')}
            </Link>
          </>
        }
        help={
          <HelpDisclosure>
            <p>{t('description')}</p>
          </HelpDisclosure>
        }
      />
      <ForecastFilterForm>
        <Form
          action={embedded ? '/forecasts' : '/forecasts/workbench'}
          className="workspace-toolbar flex flex-wrap items-end gap-3"
          key={JSON.stringify(params)}
        >
          {embedded && <input type="hidden" name="tab" value="workbench" />}
          <input type="hidden" name="size" value={params.size} />
          <input type="hidden" name="dir" value={params.dir} />
          <ForecastFilterSearchInput
            id="workbench-item-search"
            name="q"
            label={t('search')}
            clearLabel={search('clearSearch')}
            defaultValue={params.q}
            maxLength={100}
            className="min-w-0 max-w-full flex-[1_1_150px]"
          />
          <div className="grid min-w-0 max-w-full flex-[1_1_150px] gap-1">
            <label htmlFor="workbench-location">{t('location')}</label>
            <LocationCodeInput
              id="workbench-location"
              name="location"
              defaultValue={params.filters.location ?? ''}
              includeInactive
            />
          </div>
          <label className="grid min-w-0 max-w-full gap-1">
            {t('result')}
            <select
              name="status"
              defaultValue={params.filters.status ?? ''}
              className="w-full min-w-0 max-w-full rounded-md border bg-background p-2"
            >
              <option value="">{t('all')}</option>
              {POLICY_STATUSES.map((s) => (
                <option value={s} key={s}>
                  {policy(`statuses.${s}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 max-w-full gap-1">
            {t('lastProposal')}
            <select
              name="review"
              defaultValue={params.filters.review ?? ''}
              className="w-full min-w-0 max-w-full rounded-md border bg-background p-2"
            >
              <option value="">{t('all')}</option>
              {REVIEW_STATUSES.map((s) => (
                <option value={s} key={s}>
                  {t(`statuses.${s}`)}
                </option>
              ))}
            </select>
          </label>
          <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
            {t('filter')}
          </button>
          <Link
            data-forecast-filter-reset
            href={forecastWorkbenchResetHref(embedded)}
            className="inline-flex min-h-11 items-center underline"
          >
            {t('reset')}
          </Link>
        </Form>
      </ForecastFilterForm>
      <p className="text-xs text-muted-foreground">{t('count', { total })}</p>
      <TableScrollRegion label={t('title')}>
        <table className="w-full text-sm">
          <caption className="sr-only">{t('title')}</caption>
          <thead>
            <tr>
              {(
                [
                  'item',
                  'location',
                  'cutoff',
                  'unit',
                  'result',
                  'calculatedReorder',
                  'calculatedMaximum',
                  'lastProposal',
                  'inspect',
                ] as const
              ).map((k) => (
                <th className="p-2 text-start text-xs font-medium" key={k}>
                  {t(k)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <th className="p-2 text-start">{row.item_code}</th>
                <td className="p-2">{row.location_code}</td>
                <td className="p-2">{row.to_date}</td>
                <td className="p-2">{row.unit ?? policy('itemUnits')}</td>
                <td className="p-2">{policy(`statuses.${row.status}`)}</td>
                <td className="p-2 tabular-nums">{amount(row.calculated_reorder)}</td>
                <td className="p-2 tabular-nums">{amount(row.calculated_maximum)}</td>
                <td className="p-2">{t(`statuses.${row.review_status}`)}</td>
                <td className="p-2">
                  <Link
                    prefetch={false}
                    href={`/forecasts/workbench/${row.id}`}
                    className="underline"
                  >
                    {t('inspectItem', { item: row.item_code })}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
      {!rows.length && <p>{t('empty')}</p>}
      <nav aria-label={t('pagination')} className="flex gap-4">
        {params.page > 1 && (
          <Link href={href(params.page - 1)} className="underline">
            {t('previous')}
          </Link>
        )}
        <span>{t('page', { page: params.page, pages })}</span>
        {params.page < pages && (
          <Link href={href(params.page + 1)} className="underline">
            {t('next')}
          </Link>
        )}
      </nav>
    </div>
  )
}
