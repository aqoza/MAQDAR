import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { formatPurchaseCost } from '@/lib/purchase-costs'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { ReplenishmentNav } from '@/components/replenishment-nav'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { transferFreightListParams, transferFreightListSpec } from '@/lib/transfer-freight'
import {
  lastPage,
  listHref,
  nearestRange,
  toRange,
  type RawSearchParams,
} from '@/lib/master-data/list-params'
import { searchPatterns } from '@/lib/master-data/search'

export async function generateMetadata() {
  const t = await getTranslations('TransferFreight')
  return { title: t('title') }
}
export default async function TransferFreightHistory({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const params = transferFreightListParams(await searchParams)
  const [db, t, locale] = await Promise.all([createClient(), getTranslations('TransferFreight'), getLocale()])
  const query = (head: boolean) => {
    let query = db
      .from('transfer_freight_list')
      .select('*', { count: 'exact', head })
      .eq('organization_id', context.active!.id)
    for (const pattern of searchPatterns(params.q)) query = query.like('search_text', pattern)
    if (params.filters.scenario) query = query.eq('scenario_id', params.filters.scenario)
    return query
  }
  const count = await query(true)
  if (count.error) throw new Error('Freight history unavailable')
  const total = count.count ?? 0
  const pages = lastPage(total, params.size)
  const href = (page: number) =>
    listHref('/replenishment/redistribution/freight', transferFreightListSpec, params, { page })
  if (params.page > pages) redirect(href(pages))
  const { from, to } = toRange(params.page, params.size)
  const range = nearestRange(from, to, total)
  const ascending = params.dir === 'asc'
  const result = await query(false)
    .order('created_at', { ascending: range.reversed ? !ascending : ascending })
    .order('id', { ascending: !range.reversed })
    .range(range.from, range.to)
  if (result.error?.code === 'PGRST103') redirect(href(1))
  if (result.error) throw new Error('Freight history unavailable')
  const rows = range.reversed ? (result.data ?? []).toReversed() : (result.data ?? [])
  return (
    <div className="min-w-0 space-y-4 wrap-anywhere">
      <PageHeader
        title={t('title')}
        description={t('context')}
        help={
          <HelpDisclosure>
            <p>{t('method')}</p>
            <p>{t('noGuarantee')}</p>
          </HelpDisclosure>
        }
        actions={
          <Link
            className="rounded-md bg-primary px-3 py-2 text-primary-foreground"
            href="/replenishment/redistribution/dates"
          >
            {t('chooseScenario')}
          </Link>
        }
      />
      <ReplenishmentNav current="redistribution" />
      <form
        method="get"
        action="/replenishment/redistribution/freight"
        className="workspace-toolbar flex flex-wrap items-end gap-3"
        key={JSON.stringify(params)}
      >
        {params.filters.scenario && <input type="hidden" name="scenario" value={params.filters.scenario} />}
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
        <Link className="underline" href="/replenishment/redistribution/freight">
          {t('reset')}
        </Link>
      </form>
      {params.filters.scenario && (
        <Link
          className="inline-block underline"
          href={`/replenishment/redistribution/dates/${params.filters.scenario}`}
        >
          {t('source')}
        </Link>
      )}
      <p>{t('count', { count: total })}</p>
      <TableScrollRegion label={t('title')}>
        <table className="w-full min-w-[64rem] text-sm">
          <caption className="sr-only">{t('title')}</caption>
          <thead>
            <tr>
              {(
                [
                  'item',
                  'sourceLocation',
                  'destination',
                  'dispatch',
                  'basis',
                  'subtotal',
                  'inspect',
                ] as const
              ).map((key) => (
                <th key={key} className="p-2 text-start">
                  {t(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <th className="p-2 text-start">{row.item_code}</th>
                <td className="p-2">{row.source_code}</td>
                <td className="p-2">{row.destination_code}</td>
                <td className="p-2 whitespace-nowrap tabular-nums">{row.dispatch_date ?? '—'}</td>
                <td className="p-2">{row.basis === 'per_unit' || row.basis === 'per_shipment' ? t(`bases.${row.basis}`) : '—'}</td>
                <td className="p-2 whitespace-nowrap tabular-nums">{formatPurchaseCost(row.subtotal, row.currency, row.minor_units, locale)}</td>
                <td className="p-2">
                  <Link
                    className="underline"
                    prefetch={false}
                    href={`/replenishment/redistribution/freight/${row.id}`}
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
