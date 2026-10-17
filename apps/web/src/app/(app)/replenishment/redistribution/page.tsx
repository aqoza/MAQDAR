import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { ReplenishmentNav } from '@/components/replenishment-nav'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { redistributionListParams, redistributionListSpec } from '@/lib/redistribution'
import {
  lastPage,
  listHref,
  nearestRange,
  toRange,
  type RawSearchParams,
} from '@/lib/master-data/list-params'
import { searchPatterns } from '@/lib/master-data/search'
import { formatScore } from '@/lib/forecast-quality'

export async function generateMetadata() {
  const t = await getTranslations('Redistribution')
  return { title: t('title') }
}
export default async function RedistributionHistory({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const params = redistributionListParams(await searchParams)
  const [db, t, dates, locale] = await Promise.all([
    createClient(),
    getTranslations('Redistribution'),
    getTranslations('TransferDates'),
    getLocale(),
  ])
  const query = (head: boolean) => {
    let query = db
      .from('redistribution_draft_list')
      .select('*', { count: 'exact', head })
      .eq('organization_id', context.active!.id)
    for (const pattern of searchPatterns(params.q)) query = query.like('search_text', pattern)
    if (params.filters.draft) query = query.eq('draft_id', params.filters.draft)
    return query
  }
  const count = await query(true)
  if (count.error) throw new Error('Redistribution history unavailable')
  const total = count.count ?? 0
  const pages = lastPage(total, params.size)
  const href = (page: number) =>
    listHref('/replenishment/redistribution', redistributionListSpec, params, { page })
  if (params.page > pages) redirect(href(pages))
  const { from, to } = toRange(params.page, params.size)
  const range = nearestRange(from, to, total)
  const ascending = params.dir === 'asc'
  const result = await query(false)
    .order('created_at', { ascending: range.reversed ? !ascending : ascending })
    .order('id', { ascending: !range.reversed })
    .range(range.from, range.to)
  if (result.error?.code === 'PGRST103') redirect(href(1))
  if (result.error) throw new Error('Redistribution history unavailable')
  const rows = range.reversed ? (result.data ?? []).toReversed() : (result.data ?? [])
  return (
    <div className="min-w-0 space-y-4 wrap-anywhere">
      <PageHeader
        title={t('title')}
        description={t('context')}
        help={
          <HelpDisclosure>
            <p>{t('asOf')}</p>
            <p>{t('noReservation')}</p>
          </HelpDisclosure>
        }
        actions={
          <Link
            className="rounded-md bg-primary px-3 py-2 text-primary-foreground"
            href="/replenishment"
          >
            {t('chooseDestination')}
          </Link>
        }
      />
      <ReplenishmentNav current="redistribution" />
      <Link className="inline-block underline" href="/replenishment/redistribution/dates">
        {dates('title')}
      </Link>
      <form
        method="get"
        action="/replenishment/redistribution"
        className="workspace-toolbar flex flex-wrap items-end gap-3"
        key={JSON.stringify(params)}
      >
        {params.filters.draft && <input type="hidden" name="draft" value={params.filters.draft} />}
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
        <Link className="underline" href="/replenishment/redistribution">
          {t('reset')}
        </Link>
      </form>
      {params.filters.draft && (
        <Link className="inline-block underline" href={`/replenishment/${params.filters.draft}`}>
          {t('openDestination')}
        </Link>
      )}
      <p>{t('count', { count: total })}</p>
      <TableScrollRegion label={t('title')}>
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="sr-only">{t('title')}</caption>
          <thead>
            <tr>
              {(['item', 'source', 'destination', 'cutoff', 'quantity', 'inspect'] as const).map(
                (key) => (
                  <th key={key} className="p-2 text-start">
                    {t(key)}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <th className="p-2 text-start">{row.item_code}</th>
                <td className="p-2">{row.source_code}</td>
                <td className="p-2">{row.destination_code}</td>
                <td className="p-2 whitespace-nowrap">{row.cutoff}</td>
                <td className="p-2 whitespace-nowrap tabular-nums">
                  {formatScore(row.quantity, locale)} {row.unit}
                </td>
                <td className="p-2">
                  <Link
                    className="underline"
                    prefetch={false}
                    href={`/replenishment/redistribution/${row.id}`}
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
