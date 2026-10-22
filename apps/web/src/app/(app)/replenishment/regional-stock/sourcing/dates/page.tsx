import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { ReplenishmentNav } from '@/components/replenishment-nav'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { regionalDateListParams, regionalDateListSpec } from '@/lib/regional-dates'
import {
  lastPage,
  listHref,
  nearestRange,
  toRange,
  type RawSearchParams,
} from '@/lib/master-data/list-params'
import { searchPatterns } from '@/lib/master-data/search'

export async function generateMetadata() {
  const t = await getTranslations('RegionalDates')
  return { title: t('title') }
}
export default async function RegionalDateHistory({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const params = regionalDateListParams(await searchParams)
  const [db, t, locale] = await Promise.all([
    createClient(),
    getTranslations('RegionalDates'),
    getLocale(),
  ])
  const query = (head: boolean) => {
    let query = db
      .from('regional_date_list')
      .select('*', { count: 'exact', head })
      .eq('organization_id', context.active!.id)
    for (const pattern of searchPatterns(params.q)) query = query.like('search_text', pattern)
    if (params.filters.sourcing) query = query.eq('sourcing_id', params.filters.sourcing)
    return query
  }
  const count = await query(true)
  if (count.error) throw new Error('Transfer date history unavailable')
  const total = count.count ?? 0
  const pages = lastPage(total, params.size)
  const href = (page: number) =>
    listHref('/replenishment/regional-stock/sourcing/dates', regionalDateListSpec, params, { page })
  if (params.page > pages) redirect(href(pages))
  const { from, to } = toRange(params.page, params.size)
  const range = nearestRange(from, to, total)
  const ascending = params.dir === 'asc'
  const result = await query(false)
    .order('created_at', { ascending: range.reversed ? !ascending : ascending })
    .order('id', { ascending: !range.reversed })
    .range(range.from, range.to)
  if (result.error?.code === 'PGRST103') redirect(href(1))
  if (result.error) throw new Error('Transfer date history unavailable')
  const rows = range.reversed ? (result.data ?? []).toReversed() : (result.data ?? [])
  return (
    <div className="min-w-0 space-y-4 wrap-anywhere">
      <PageHeader
        pattern="replenishment"
        navigation={<ReplenishmentNav current="regionalStock" />}
        title={t('title')}
        description={t('context')}
        help={
          <HelpDisclosure>
            <p>{t('method')}</p>
            <p>{t('noGuarantee')}</p>
          </HelpDisclosure>
        }
        actions={
          <>
            <Link
              className="rounded-md bg-primary px-3 py-2 text-primary-foreground"
              href="/replenishment/regional-stock/sourcing"
            >
              {t('chooseDraft')}
            </Link>
          </>
        }
      />
      <form
        method="get"
        action="/replenishment/regional-stock/sourcing/dates"
        className="workspace-toolbar flex flex-wrap items-end gap-3"
        key={JSON.stringify(params)}
      >
        {params.filters.sourcing && (
          <input type="hidden" name="sourcing" value={params.filters.sourcing} />
        )}
        <label className="grid min-w-0 gap-1">
          {t('search')}
          <input
            name="q"
            maxLength={100}
            defaultValue={params.q}
            className="w-full min-w-0 rounded-md border bg-background p-2"
          />
        </label>
        <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
          {t('filter')}
        </button>
        <Link className="underline" href="/replenishment/regional-stock/sourcing/dates">
          {t('reset')}
        </Link>
      </form>
      {params.filters.sourcing && (
        <Link
          className="inline-block underline"
          href={`/replenishment/regional-stock/sourcing/${params.filters.sourcing}`}
        >
          {t('source')}
        </Link>
      )}
      <p>{t('count', { count: total })}</p>
      <TableScrollRegion label={t('title')}>
        <table className="w-full min-w-[46rem] text-sm">
          <caption className="sr-only">{t('title')}</caption>
          <thead>
            <tr>
              {(['item', 'destination', 'region', 'requested', 'status', 'inspect'] as const).map(
                (key) => (
                  <th key={key} className="p-2 text-start text-xs font-medium">
                    {t(key)}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <th className="p-2 text-start whitespace-nowrap">
                  <bdi>{row.item_code}</bdi>
                </th>
                <td className="p-2 whitespace-nowrap">
                  <bdi>{row.destination_code}</bdi>
                </td>
                <td className="p-2">
                  {locale.startsWith('ar')
                    ? row.region_name_ar || row.region_name
                    : row.region_name}
                </td>
                <td className="p-2 whitespace-nowrap tabular-nums">
                  <bdi>{row.requested_date ?? '—'}</bdi>
                </td>
                <td className="p-2">
                  {t(`statuses.${row.status as 'available' | 'no_transfer_needed'}`)}
                </td>
                <td className="p-2">
                  <Link
                    className="underline"
                    prefetch={false}
                    href={`/replenishment/regional-stock/sourcing/dates/${row.id}`}
                  >
                    {t('inspectItem', { item: row.item_code ?? '—' })}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
      {!rows.length && <p>{t('empty')}</p>}
      <nav aria-label={t('pagination')} className="flex flex-wrap gap-4">
        {params.page > 1 && (
          <Link className="underline" href={href(params.page - 1)}>
            {t('previous')}
          </Link>
        )}
        <span>{t('page', { page: params.page, pages })}</span>
        {params.page < pages && (
          <Link className="underline" href={href(params.page + 1)}>
            {t('next')}
          </Link>
        )}
      </nav>
    </div>
  )
}
