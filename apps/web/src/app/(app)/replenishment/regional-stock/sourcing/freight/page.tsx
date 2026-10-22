import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { ReplenishmentNav } from '@/components/replenishment-nav'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { regionalFreightListParams, regionalFreightListSpec } from '@/lib/regional-freight'
import {
  lastPage,
  listHref,
  nearestRange,
  toRange,
  type RawSearchParams,
} from '@/lib/master-data/list-params'
import { searchPatterns } from '@/lib/master-data/search'

export async function generateMetadata() {
  const t = await getTranslations('RegionalFreight')
  return { title: t('title') }
}
export default async function RegionalFreightHistory({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const tr = await getTranslations('RegionalReview')
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const locale = await getLocale()
  const params = regionalFreightListParams(await searchParams)
  const [db, t] = await Promise.all([createClient(), getTranslations('RegionalFreight')])
  const query = (head: boolean) => {
    let query = db
      .from('regional_freight_list')
      .select('*', { count: 'exact', head })
      .eq('organization_id', context.active!.id)
    for (const pattern of searchPatterns(params.q)) query = query.like('search_text', pattern)
    if (params.filters.scenario) query = query.eq('scenario_id', params.filters.scenario)
    return query
  }
  const count = await query(true)
  if (count.error) throw new Error('Transfer date history unavailable')
  const total = count.count ?? 0
  const pages = lastPage(total, params.size)
  const href = (page: number) =>
    listHref('/replenishment/regional-stock/sourcing/freight', regionalFreightListSpec, params, {
      page,
    })
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
            <Link className="underline" href="/replenishment/regional-stock/sourcing/review">
              {tr('title')}
            </Link>
            <Link
              className="rounded-md bg-primary px-3 py-2 text-primary-foreground"
              href="/replenishment/regional-stock/sourcing/dates"
            >
              {t('chooseScenario')}
            </Link>
          </>
        }
      />
      <form
        method="get"
        action="/replenishment/regional-stock/sourcing/freight"
        className="workspace-toolbar flex flex-wrap items-end gap-3"
        key={JSON.stringify(params)}
      >
        {params.filters.scenario && (
          <input type="hidden" name="scenario" value={params.filters.scenario} />
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
        <Link className="underline" href="/replenishment/regional-stock/sourcing/freight">
          {t('reset')}
        </Link>
      </form>
      {params.filters.scenario && (
        <Link
          className="inline-block underline"
          href={`/replenishment/regional-stock/sourcing/dates/${params.filters.scenario}`}
        >
          {t('source')}
        </Link>
      )}
      <p>{t('count', { count: total })}</p>
      <TableScrollRegion label={t('title')}>
        <table className="w-full min-w-[56rem] text-sm">
          <caption className="sr-only">{t('title')}</caption>
          <thead>
            <tr>
              {(
                [
                  'item',
                  'region',
                  'destination',
                  'sources',
                  'requested',
                  'status',
                  'inspect',
                ] as const
              ).map((key) => (
                <th key={key} className="p-2 text-start text-xs font-medium whitespace-nowrap">
                  {t(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <th className="p-2 text-start font-medium whitespace-nowrap">
                  <bdi>{row.item_code}</bdi>
                </th>
                <td className="p-2">
                  {locale.startsWith('ar')
                    ? row.region_name_ar || row.region_name
                    : row.region_name}
                </td>
                <td className="p-2">
                  <bdi>{row.destination_code}</bdi>
                </td>
                <td className="p-2">{row.source_count}</td>
                {[row.requested_date].map((date, index) => (
                  <td className="p-2 whitespace-nowrap tabular-nums" key={index}>
                    {date ?? '—'}
                  </td>
                ))}
                <td className="p-2">
                  {t(`statuses.${row.status as 'available' | 'no_transfer_needed'}`)}
                </td>
                <td className="p-2">
                  <Link
                    className="underline"
                    prefetch={false}
                    href={`/replenishment/regional-stock/sourcing/freight/${row.id}`}
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
