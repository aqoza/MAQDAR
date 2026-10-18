import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { ExcessStockHeader } from '@/components/excess-stock-header'
import { ExcessStockFilters, ExcessStockPagination } from '@/components/excess-stock-list-controls'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import {
  excessCutoff,
  excessHistorySchema,
  excessListParams,
  excessListSpec,
} from '@/lib/excess-stock'
import {
  lastPage,
  listHref,
  nearestRange,
  toRange,
  type RawSearchParams,
} from '@/lib/master-data/list-params'
import { searchPatterns } from '@/lib/master-data/search'
import { formatCostDecimal } from '@/lib/purchase-costs'

export async function generateMetadata() {
  return { title: (await getTranslations('ExcessStock'))('title') }
}
export default async function Assessments({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const [raw, db, t, locale, format] = await Promise.all([
    searchParams,
    createClient(),
    getTranslations('ExcessStock'),
    getLocale(),
    getFormatter(),
  ])
  const params = excessListParams(raw)
  const cutoff = excessCutoff(raw)
  const query = (head: boolean) => {
    let q = db
      .from('excess_stock_assessment_list')
      .select('*', { count: 'exact', head })
      .eq('organization_id', context.active!.id)
    for (const pattern of searchPatterns(params.q)) q = q.like('search_text', pattern)
    if (params.filters.location) q = q.eq('location_code', params.filters.location)
    if (cutoff) q = q.eq('cutoff', cutoff)
    return q
  }
  const count = await query(true)
  if (count.error) throw new Error('Assessment history unavailable')
  const total = count.count ?? 0
  const pages = lastPage(total, params.size)
  const href = (page: number) => {
    const url = new URL(
      listHref('/replenishment/excess', excessListSpec, params, { page }),
      'https://local.invalid',
    )
    if (cutoff) url.searchParams.set('cutoff', cutoff)
    return `${url.pathname}${url.search}`
  }
  if (params.page > pages) redirect(href(pages))
  const { from, to } = toRange(params.page, params.size)
  const range = nearestRange(from, to, total)
  const result = await query(false)
    .order('created_at', {
      ascending: range.reversed ? params.dir !== 'asc' : params.dir === 'asc',
    })
    .order('id', { ascending: !range.reversed })
    .range(range.from, range.to)
  if (result.error?.code === 'PGRST103') redirect(href(1))
  if (result.error) throw new Error('Assessment history unavailable')
  const rows = z
    .array(excessHistorySchema)
    .parse(range.reversed ? result.data.toReversed() : result.data)
  return (
    <div className="min-w-0 space-y-4">
      <ExcessStockHeader create={['owner', 'admin', 'planner'].includes(context.active.role)} />
      <ExcessStockFilters params={params} cutoff={cutoff} />
      <TableScrollRegion label={t('history')}>
        <table className="w-full text-sm">
          <thead>
            <tr>
              {(['saved', 'location', 'cutoff', 'items', 'totals', 'reason'] as const).map(
                (key) => (
                  <th key={key} className="p-3 text-start text-xs font-medium">
                    {t(key)}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t align-top">
                <td className="p-3">
                  <Link className="underline" href={`/replenishment/excess/${row.id}`}>
                    {format.dateTime(new Date(row.created_at), 'long')}
                  </Link>
                </td>
                <td className="p-3">{row.location_code}</td>
                <td className="whitespace-nowrap p-3">
                  {format.dateTime(new Date(row.cutoff), { dateStyle: 'medium', timeZone: 'UTC' })}
                </td>
                <td className="p-3">{row.line_count}</td>
                <td className="p-3">
                  {row.totals.map((v) => (
                    <p key={v.currency} className="whitespace-nowrap tabular-nums">
                      <bdi>
                        {formatCostDecimal(v.value, locale, 100)} {v.currency}
                      </bdi>
                    </p>
                  ))}
                </td>
                <td className="min-w-48 max-w-md break-words p-3">{row.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
      {!rows.length && <p>{t('empty')}</p>}
      <ExcessStockPagination
        page={params.page}
        pages={pages}
        previous={params.page > 1 ? href(params.page - 1) : undefined}
        next={params.page < pages ? href(params.page + 1) : undefined}
      />
    </div>
  )
}
