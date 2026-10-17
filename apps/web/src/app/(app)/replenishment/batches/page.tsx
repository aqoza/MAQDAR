import { HelpDisclosure } from '@/components/help-disclosure'
import { PageHeader } from '@/components/page-header'
import { ReplenishmentNav } from '@/components/replenishment-nav'
import Form from 'next/form'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'
import { batchListParams, batchListSpec, batchRowSchema } from '@/lib/handoff-batches'
import {
  lastPage,
  listHref,
  nearestRange,
  toRange,
  type RawSearchParams,
} from '@/lib/master-data/list-params'
import { searchPatterns } from '@/lib/master-data/search'
import { formatPurchaseCost } from '@/lib/purchase-costs'
import { formatDateOnly } from '@/lib/format'

export default async function HandoffBatches({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const params = batchListParams(await searchParams)
  const [db, t, locale, format] = await Promise.all([
    createClient(),
    getTranslations('HandoffBatches'),
    getLocale(),
    getFormatter(),
  ])
  const query = (head: boolean) => {
    let q = db
      .from('purchase_handoff_batch_list')
      .select('*', { count: 'exact', head })
      .eq('organization_id', context.active!.id)
    for (const pattern of searchPatterns(params.q)) q = q.like('search_text', pattern)
    if (params.filters.location) q = q.eq('location_code', params.filters.location)
    if (params.filters.supplier) q = q.eq('supplier_code', params.filters.supplier)
    if (params.filters.selection) q = q.eq('selected', params.filters.selection === 'current')
    return q
  }
  const count = await query(true)
  if (count.error) throw new Error('Batch list unavailable')
  const total = count.count ?? 0
  const pages = lastPage(total, params.size)
  const href = (page: number) => listHref('/replenishment/batches', batchListSpec, params, { page })
  if (params.page > pages) redirect(href(pages))
  const { from, to } = toRange(params.page, params.size)
  const range = nearestRange(from, to, total)
  const ascending = params.dir === 'asc'
  const result = await query(false)
    .order('created_at', { ascending: range.reversed ? !ascending : ascending })
    .order('id', { ascending: !range.reversed })
    .range(range.from, range.to)
  if (result.error?.code === 'PGRST103') redirect(href(1))
  if (result.error) throw new Error('Batch list unavailable')
  const rows = (range.reversed ? (result.data ?? []).toReversed() : (result.data ?? [])).map(
    (row) => batchRowSchema.parse(row),
  )
  return (
    <div className="space-y-4">
      <PageHeader
        pattern="replenishment"
        navigation={<ReplenishmentNav current="batches" />}
        title={t('title')}
        description={t('context')}
        help={
          <HelpDisclosure>
            <p>{t('description')}</p>
          </HelpDisclosure>
        }
        actions={
          isEditorRole(context.role) && (
            <Link
              className="inline-block rounded-md bg-primary px-4 py-2 text-primary-foreground"
              href="/replenishment/batches/new"
            >
              {t('choose')}
            </Link>
          )
        }
      />
      <Form
        action="/replenishment/batches"
        className="workspace-toolbar flex flex-wrap items-end gap-3"
        key={JSON.stringify(params)}
      >
        <label className="grid min-w-0 max-w-full gap-1">
          {t('search')}
          <input
            name="q"
            maxLength={100}
            defaultValue={params.q}
            className="w-full min-w-0 max-w-full rounded-md border bg-background p-2"
          />
        </label>
        <label className="grid min-w-0 max-w-full gap-1">
          {t('supplier')}
          <input
            name="supplier"
            maxLength={64}
            defaultValue={params.filters.supplier ?? ''}
            className="w-full min-w-0 max-w-full rounded-md border bg-background p-2"
          />
        </label>
        <label className="grid min-w-0 max-w-full gap-1">
          {t('location')}
          <input
            name="location"
            maxLength={64}
            defaultValue={params.filters.location ?? ''}
            className="w-full min-w-0 max-w-full rounded-md border bg-background p-2"
          />
        </label>
        <label className="grid min-w-0 max-w-full gap-1">
          {t('selection')}
          <select
            name="selection"
            defaultValue={params.filters.selection ?? ''}
            className="w-full min-w-0 max-w-full rounded-md border bg-background p-2"
          >
            <option value="">{t('all')}</option>
            {(['current', 'historical'] as const).map((key) => (
              <option key={key} value={key}>
                {t(key)}
              </option>
            ))}
          </select>
        </label>
        <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
          {t('filter')}
        </button>
        <Link className="underline" href="/replenishment/batches">
          {t('reset')}
        </Link>
      </Form>
      <p>{t('count', { total })}</p>
      <TableScrollRegion label={t('title')}>
        <table className="w-full text-sm">
          <caption className="sr-only">{t('title')}</caption>
          <thead>
            <tr>
              {(
                [
                  'saved',
                  'supplier',
                  'location',
                  'orderDate',
                  'lines',
                  'subtotal',
                  'selection',
                  'overlap',
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
                <th className="p-2 text-start">
                  {format.dateTime(new Date(row.created_at), 'long')}
                </th>
                <td className="p-2">{row.supplier_code}</td>
                <td className="p-2">{row.location_code}</td>
                <td className="p-2">{formatDateOnly(format, row.order_date)}</td>
                <td className="p-2">{row.line_count}</td>
                <td className="p-2">
                  {formatPurchaseCost(row.subtotal, row.currency, row.minor_units, locale)}
                </td>
                <td className="p-2">{t(row.selected ? 'current' : 'historical')}</td>
                <td className="p-2">{row.overlap_count}</td>
                <td className="p-2">
                  <Link
                    className="underline"
                    prefetch={false}
                    href={`/replenishment/batches/${row.id}`}
                  >
                    {t('inspectBatch', { supplier: row.supplier_code })}
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
