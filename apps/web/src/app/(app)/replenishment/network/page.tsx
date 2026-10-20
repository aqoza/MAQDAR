import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { ReplenishmentNav } from '@/components/replenishment-nav'
import { HelpDisclosure } from '@/components/help-disclosure'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { redistributionListParams } from '@/lib/redistribution'
import {
  lastPage,
  nearestRange,
  toRange,
  type RawSearchParams,
} from '@/lib/master-data/list-params'
import { searchPatterns } from '@/lib/master-data/search'
import { formatScore } from '@/lib/forecast-quality'

export async function generateMetadata() {
  const t = await getTranslations('NetworkAllocation')
  return { title: t('title') }
}
export default async function NetworkHistory({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const params = redistributionListParams(await searchParams)
  const [db, t, locale, dates, review] = await Promise.all([
    createClient(),
    getTranslations('NetworkAllocation'),
    getLocale(),
    getTranslations('NetworkDates'),
    getTranslations('NetworkReview'),
  ])
  const query = (head: boolean) => {
    let q = db
      .from('network_allocation_list')
      .select('*', { count: 'exact', head })
      .eq('organization_id', context.active!.id)
    for (const pattern of searchPatterns(params.q)) q = q.like('search_text', pattern)
    return q
  }
  const count = await query(true)
  if (count.error) throw new Error('Allocation history unavailable')
  const total = count.count ?? 0
  const pages = lastPage(total, params.size)
  const href = (page: number) =>
    `/replenishment/network?${new URLSearchParams({ q: params.q, page: String(page), size: String(params.size) })}`
  if (params.page > pages) redirect(href(pages))
  const { from, to } = toRange(params.page, params.size)
  const range = nearestRange(from, to, total)
  const result = await query(false)
    .order('created_at', { ascending: range.reversed })
    .order('id', { ascending: !range.reversed })
    .range(range.from, range.to)
  if (result.error?.code === 'PGRST103') redirect(href(1))
  if (result.error) throw new Error('Allocation history unavailable')
  const rows = range.reversed ? (result.data ?? []).toReversed() : (result.data ?? [])
  const th = await getTranslations('NetworkHandoffs')
  return (
    <div className="min-w-0 space-y-4 wrap-anywhere">
      <PageHeader
        pattern="replenishment"
        title={t('title')}
        description={t('context')}
        navigation={<ReplenishmentNav current="network" />}
        actions={
          <>
            <Link href="/replenishment/network/handoffs" className="inline-block underline">
              {th('title')}
            </Link>
            <Link
              className="rounded-md bg-primary px-3 py-2 text-primary-foreground"
              href="/replenishment/network/new"
            >
              {t('create')}
            </Link>
            <Link className="underline" href="/replenishment/network/dates">
              {dates('dateHistory')}
            </Link>
            <Link className="underline" href="/replenishment/network/review">
              {review('title')}
            </Link>
          </>
        }
        help={
          <HelpDisclosure>
            <p>{t('method')}</p>
            <p>{t('planningOnly')}</p>
          </HelpDisclosure>
        }
      />
      <form
        className="workspace-toolbar flex flex-wrap items-end gap-3"
        action="/replenishment/network"
      >
        <label className="grid min-w-0 gap-1">
          {t('searchHistory')}
          <input
            className="w-full min-w-0 rounded-md border bg-background p-2"
            name="q"
            defaultValue={params.q}
            maxLength={100}
          />
        </label>
        <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
          {t('search')}
        </button>
      </form>
      <p>{t('count', { count: total })}</p>
      <TableScrollRegion label={t('title')}>
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr>
              {(['item', 'source', 'cutoff', 'branches', 'allocated', 'inspect'] as const).map(
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
                <td className="p-2">{row.cutoff}</td>
                <td className="p-2">{row.branch_count}</td>
                <td className="p-2">
                  {formatScore(row.allocated, locale)} {row.unit}
                </td>
                <td className="p-2">
                  <Link
                    className="underline"
                    prefetch={false}
                    href={`/replenishment/network/${row.id}`}
                  >
                    {t('inspect')}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
      {!rows.length && <p>{t('empty')}</p>}
      <nav className="flex flex-wrap gap-3" aria-label={t('pagination')}>
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
