import { HelpDisclosure } from '@/components/help-disclosure'
import { PageHeader } from '@/components/page-header'
import { formatCostDecimal, formatPurchaseCost } from '@/lib/purchase-costs'
import Form from 'next/form'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { handoffListParams, handoffRowSchema, handoffListSpec } from '@/lib/purchase-handoffs'
import {
  lastPage,
  listHref,
  nearestRange,
  toRange,
  type RawSearchParams,
} from '@/lib/master-data/list-params'
import { searchPatterns } from '@/lib/master-data/search'

export default async function PurchaseHandoffs({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const params = handoffListParams(await searchParams)
  const [db, t, locale] = await Promise.all([
    createClient(),
    getTranslations('PurchaseHandoffs'),
    getLocale(),
  ])
  const organizationId = context.active.id
  const query = (head: boolean) => {
    let q = db
      .from('purchase_handoff_list')
      .select('*', { count: 'exact', head })
      .eq('organization_id', organizationId)
    for (const pattern of searchPatterns(params.q)) q = q.like('search_text', pattern)
    if (params.filters.location) q = q.eq('location_code', params.filters.location)
    if (params.filters.selection) q = q.eq('selected', params.filters.selection === 'current')
    if (params.filters.supplier) q = q.eq('supplier_code', params.filters.supplier)
    return q
  }
  const count = await query(true)
  if (count.error) throw new Error('Purchase review unavailable')
  const total = count.count ?? 0
  const pages = lastPage(total, params.size)
  const href = (page: number) =>
    listHref('/replenishment/handoffs', handoffListSpec, params, { page })
  if (params.page > pages) redirect(href(pages))
  const { from, to } = toRange(params.page, params.size)
  const range = nearestRange(from, to, total)
  const ascending = params.dir === 'asc'
  const result = await query(false)
    .order('created_at', { ascending: range.reversed ? !ascending : ascending })
    .order('id', { ascending: !range.reversed })
    .range(range.from, range.to)
  if (result.error?.code === 'PGRST103') redirect(href(1))
  if (result.error) throw new Error('Purchase review unavailable')
  const rows = (range.reversed ? (result.data ?? []).toReversed() : (result.data ?? [])).map(
    (row) => handoffRowSchema.parse(row),
  )
  return (
    <div className="space-y-5">
      <Link href="/replenishment" className="text-sm underline">
        {t('planning')}
      </Link>
      <Link className="inline-block underline" href="/replenishment/batches">
        {t('batches')}
      </Link>
      <div className="space-y-1">
        <PageHeader title={t('title')} description={t('context')} />
        <HelpDisclosure>
          <p>{t('description')}</p>
        </HelpDisclosure>
      </div>
      <Form
        action="/replenishment/handoffs"
        className="flex flex-wrap items-end gap-3"
        key={JSON.stringify(params)}
      >
        <label className="grid gap-1">
          {t('search')}
          <input
            name="q"
            defaultValue={params.q}
            maxLength={100}
            className="rounded-md border bg-background p-2"
          />
        </label>
        <label className="grid gap-1">
          {t('location')}
          <input
            name="location"
            defaultValue={params.filters.location ?? ''}
            maxLength={64}
            className="rounded-md border bg-background p-2"
          />
        </label>
        <label className="grid gap-1">
          {t('supplier')}
          <input
            name="supplier"
            maxLength={64}
            defaultValue={params.filters.supplier ?? ''}
            className="rounded-md border bg-background p-2"
          />
        </label>
        <label className="grid gap-1">
          {t('selection')}
          <select
            name="selection"
            defaultValue={params.filters.selection ?? ''}
            className="rounded-md border bg-background p-2"
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
        <Link href="/replenishment/handoffs" className="underline">
          {t('reset')}
        </Link>
      </Form>
      <p>{t('count', { total })}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('title')}</caption>
          <thead>
            <tr>
              {(
                [
                  'item',
                  'location',
                  'supplier',
                  'quantity',
                  'subtotal',
                  'selection',
                  'inspect',
                ] as const
              ).map((k) => (
                <th className="p-2 text-start" key={k}>
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
                <td className="p-2">{row.supplier_code}</td>
                <td className="p-2">
                  {formatCostDecimal(row.quantity, locale)} {row.unit}
                </td>
                <td className="p-2">
                  {formatPurchaseCost(row.subtotal, row.currency, row.minor_units, locale)}
                </td>
                <td className="p-2">{t(row.selected ? 'current' : 'historical')}</td>
                <td className="p-2">
                  <Link
                    prefetch={false}
                    href={`/replenishment/handoffs/${row.id}`}
                    className="underline"
                  >
                    {t('inspectItem', { item: row.item_code })}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
