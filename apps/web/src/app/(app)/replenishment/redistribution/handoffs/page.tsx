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
import { handoffListParams, handoffRowSchema, handoffListSpec } from '@/lib/transfer-handoffs'
import {
  lastPage,
  listHref,
  nearestRange,
  toRange,
  type RawSearchParams,
} from '@/lib/master-data/list-params'
import { searchPatterns } from '@/lib/master-data/search'

export default async function TransferHandoffs({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const params = handoffListParams(await searchParams)
  const [db, t, locale] = await Promise.all([
    createClient(),
    getTranslations('TransferHandoffs'),
    getLocale(),
  ])
  const organizationId = context.active.id
  const query = (head: boolean) => {
    let q = db
      .from('transfer_handoff_list')
      .select('*', { count: 'exact', head })
      .eq('organization_id', organizationId)
    for (const pattern of searchPatterns(params.q)) q = q.like('search_text', pattern)
    if (params.filters.location) q = q.eq('location_code', params.filters.location)
    if (params.filters.selection) q = q.eq('selected', params.filters.selection === 'current')
    if (params.filters.source) q = q.eq('source_code', params.filters.source)
    return q
  }
  const count = await query(true)
  if (count.error) throw new Error('Transfer handoff history unavailable')
  const total = count.count ?? 0
  const pages = lastPage(total, params.size)
  const href = (page: number) =>
    listHref('/replenishment/redistribution/handoffs', handoffListSpec, params, { page })
  if (params.page > pages) redirect(href(pages))
  const { from, to } = toRange(params.page, params.size)
  const range = nearestRange(from, to, total)
  const ascending = params.dir === 'asc'
  const result = await query(false)
    .order('created_at', { ascending: range.reversed ? !ascending : ascending })
    .order('id', { ascending: !range.reversed })
    .range(range.from, range.to)
  if (result.error?.code === 'PGRST103') redirect(href(1))
  if (result.error) throw new Error('Transfer handoff history unavailable')
  const rows = (range.reversed ? (result.data ?? []).toReversed() : (result.data ?? [])).map(
    (row) => handoffRowSchema.parse(row),
  )
  return (
    <div className="min-w-0 space-y-4 wrap-anywhere">
      <PageHeader
        pattern="replenishment"
        navigation={<ReplenishmentNav current="redistribution" />}
        title={t('title')}
        description={t('context')}
        help={
          <HelpDisclosure>
            <p>{t('description')}</p>
          </HelpDisclosure>
        }
      />
      <Link className="inline-block underline" href="/replenishment/redistribution/integrations">
        {t('integrations')}
      </Link>
      <Link href="/replenishment/redistribution/review" className="inline-block underline">
        {t('review')}
      </Link>
      <Link href="/replenishment/redistribution/batches" className="inline-block underline">
        {t('batches')}
      </Link>
      <Form
        action="/replenishment/redistribution/handoffs"
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
          {t('location')}
          <input
            name="location"
            defaultValue={params.filters.location ?? ''}
            maxLength={64}
            className="w-full min-w-0 rounded-md border bg-background p-2"
          />
        </label>
        <label className="grid min-w-0 gap-1">
          {t('source')}
          <input
            name="source"
            maxLength={64}
            defaultValue={params.filters.source ?? ''}
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
        <Link href="/replenishment/redistribution/handoffs" className="underline">
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
                  'location',
                  'source',
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
                <th className="p-2 text-start">{row.item_code}</th>
                <td className="p-2">{row.location_code}</td>
                <td className="p-2">{row.source_code}</td>
                <td className="p-2 whitespace-nowrap tabular-nums">
                  {formatCostDecimal(row.quantity, locale)} {row.unit}
                </td>
                <td className="p-2 whitespace-nowrap tabular-nums">
                  {formatPurchaseCost(row.subtotal, row.currency, row.minor_units, locale)}
                </td>
                <td className="p-2 whitespace-nowrap">
                  {t(row.selected ? 'current' : 'historical')}
                </td>
                <td className="p-2">
                  <Link
                    prefetch={false}
                    href={`/replenishment/redistribution/handoffs/${row.id}`}
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
