import { TableScrollRegion } from '@/components/table-scroll-region'
import { HelpDisclosure } from '@/components/help-disclosure'
import { PageHeader } from '@/components/page-header'
import { ReplenishmentNav } from '@/components/replenishment-nav'
import { formatCostDecimal, formatPurchaseCost } from '@/lib/purchase-costs'
import Form from 'next/form'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { handoffListParams, handoffRowSchema, handoffListSpec } from '@/lib/regional-handoffs'
import {
  lastPage,
  listHref,
  nearestRange,
  toRange,
  type RawSearchParams,
} from '@/lib/master-data/list-params'
import { searchPatterns } from '@/lib/master-data/search'

export default async function RegionalHandoffs({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const params = handoffListParams(await searchParams)
  const [db, t, locale] = await Promise.all([
    createClient(),
    getTranslations('RegionalHandoffs'),
    getLocale(),
  ])
  const organizationId = context.active.id
  const query = (head: boolean) => {
    let q = db
      .from('regional_handoff_list')
      .select('*', { count: 'exact', head })
      .eq('organization_id', organizationId)
    for (const pattern of searchPatterns(params.q)) q = q.like('search_text', pattern)
    if (params.filters.selection) q = q.eq('selected', params.filters.selection === 'current')
    if (params.filters.destination) q = q.eq('destination_code', params.filters.destination)
    return q
  }
  const count = await query(true)
  if (count.error) throw new Error('Regional handoff history unavailable')
  const total = count.count ?? 0
  const pages = lastPage(total, params.size)
  const href = (page: number) =>
    listHref('/replenishment/regional-stock/sourcing/handoffs', handoffListSpec, params, { page })
  if (params.page > pages) redirect(href(pages))
  const { from, to } = toRange(params.page, params.size)
  const range = nearestRange(from, to, total)
  const ascending = params.dir === 'asc'
  const result = await query(false)
    .order('created_at', { ascending: range.reversed ? !ascending : ascending })
    .order('id', { ascending: !range.reversed })
    .range(range.from, range.to)
  if (result.error?.code === 'PGRST103') redirect(href(1))
  if (result.error) throw new Error('Regional handoff history unavailable')
  const rows = (range.reversed ? (result.data ?? []).toReversed() : (result.data ?? [])).map(
    (row) => handoffRowSchema.parse(row),
  )
  return (
    <div className="min-w-0 space-y-4 wrap-anywhere">
      <PageHeader
        pattern="replenishment"
        navigation={<ReplenishmentNav current="regionalStock" />}
        title={t('title')}
        description={t('context')}
        actions={
          <>
            <Link href="/replenishment/regional-stock/sourcing/review" className="underline">
              {t('review')}
            </Link>
          </>
        }
        help={
          <HelpDisclosure>
            <p>{t('description')}</p>
          </HelpDisclosure>
        }
      />
      <Form
        action="/replenishment/regional-stock/sourcing/handoffs"
        className="workspace-toolbar flex flex-wrap items-end gap-3"
        key={JSON.stringify(params)}
      >
        <label className="grid min-w-0 gap-1">
          {t('search')}
          <input
            name="q"
            defaultValue={params.q}
            maxLength={100}
            className="w-full min-w-0 rounded-md border bg-background p-2"
          />
        </label>
        <label className="grid min-w-0 gap-1">
          {t('destination')}
          <input
            name="destination"
            maxLength={64}
            defaultValue={params.filters.destination ?? ''}
            className="w-full min-w-0 rounded-md border bg-background p-2"
          />
        </label>
        <label className="grid min-w-0 gap-1">
          {t('selection')}
          <select
            name="selection"
            defaultValue={params.filters.selection ?? ''}
            className="w-full min-w-0 rounded-md border bg-background p-2"
          >
            <option value="">{t('all')}</option>
            {(['current', 'historical'] as const).map((s) => (
              <option key={s} value={s}>
                {t(s)}
              </option>
            ))}
          </select>
        </label>
        <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
          {t('filter')}
        </button>
        <Link href="/replenishment/regional-stock/sourcing/handoffs" className="underline">
          {t('reset')}
        </Link>
      </Form>
      <p>{t('count', { total })}</p>
      <TableScrollRegion label={t('title')}>
        <table className="w-full min-w-[60rem] text-sm">
          <caption className="sr-only">{t('title')}</caption>
          <thead>
            <tr>
              {(
                [
                  'item',
                  'region',
                  'sources',
                  'requested',
                  'destination',
                  'quantity',
                  'subtotal',
                  'selection',
                  'inspect',
                ] as const
              ).map((k) => (
                <th className="p-2 text-start whitespace-nowrap" key={k}>
                  {t(k)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <th className="min-w-24 max-w-48 p-2 text-start">{row.item_code}</th>
                <td className="min-w-48 max-w-64 p-2">
                  {locale.startsWith('ar')
                    ? row.region_name_ar || row.region_name
                    : row.region_name}
                </td>
                <td className="p-2">{row.source_count}</td>
                <td className="p-2 whitespace-nowrap">{row.requested_date}</td>
                <td className="p-2">{row.destination_code}</td>
                <td className="p-2 whitespace-nowrap tabular-nums">
                  {formatCostDecimal(row.quantity, locale)} {row.unit}
                </td>
                <td className="p-2 whitespace-nowrap tabular-nums">
                  {row.totals.map((total) => (
                    <div key={total.currency}>
                      {formatPurchaseCost(
                        total.subtotal,
                        total.currency,
                        total.minor_units,
                        locale,
                      )}
                    </div>
                  ))}
                </td>
                <td className="p-2 whitespace-nowrap">
                  {t(row.selected ? 'current' : 'historical')}
                </td>
                <td className="p-2">
                  <Link
                    prefetch={false}
                    href={`/replenishment/regional-stock/sourcing/handoffs/${row.id}`}
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
