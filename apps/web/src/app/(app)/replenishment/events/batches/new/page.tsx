import { TableScrollRegion } from '@/components/table-scroll-region'
import { PageHeader } from '@/components/page-header'
import { EventHandoffBatchesHelp } from '@/components/event-handoff-batches-help'
import Form from 'next/form'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'
import { batchInputSchema, batchSelection, batchSelectionHref } from '@/lib/event-handoff-batches'
import { handoffListParams, handoffListSpec, handoffRowSchema } from '@/lib/event-purchase-handoffs'
import {
  lastPage,
  listHref,
  nearestRange,
  toRange,
  type RawSearchParams,
} from '@/lib/master-data/list-params'
import { searchPatterns } from '@/lib/master-data/search'
import { formatPurchaseCost, formatCostDecimal } from '@/lib/purchase-costs'
import { formatDateOnly } from '@/lib/format'
import { EventHandoffBatchOverlap } from '@/components/event-handoff-batch-overlap'

const rowSchema = handoffRowSchema.extend({
  order_date: z.iso.date(),
  batch_count: z.number().int(),
})
export default async function BatchSelection({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  if (!isEditorRole(context.role)) redirect('/replenishment/events/batches')
  const [t, db, locale, format, raw] = await Promise.all([
    getTranslations('EventHandoffBatches'),
    createClient(),
    getLocale(),
    getFormatter(),
    searchParams,
  ])
  const ids = batchSelection(raw)
  if (ids.length && !batchInputSchema.safeParse(ids).success)
    return (
      <div className="space-y-3">
        <p role="alert">{t('invalidSelection')}</p>
        <Link className="underline" href="/replenishment/events/batches/new">
          {t('clear')}
        </Link>
      </div>
    )
  const params = handoffListParams(raw)
  const date = z.iso.date().safeParse(raw.order_date)
  const orderDate = date.success ? date.data : ''
  const selected = ids.length
    ? await db
        .from('event_purchase_handoff_batch_candidates')
        .select('*')
        .eq('organization_id', context.active.id)
        .in('id', ids)
        .order('id')
    : { data: [], error: null }
  if (selected.error) throw new Error('Batch selection unavailable')
  const chosen = (selected.data ?? []).map((row) => rowSchema.parse(row))
  const query = (head: boolean) => {
    let q = db
      .from('event_purchase_handoff_batch_candidates')
      .select('*', { count: 'exact', head })
      .eq('organization_id', context.active!.id)
      .eq('selected', true)
    for (const pattern of searchPatterns(params.q)) q = q.like('search_text', pattern)
    if (params.filters.supplier) q = q.eq('supplier_code', params.filters.supplier)
    if (params.filters.location) q = q.eq('location_code', params.filters.location)
    if (orderDate) q = q.eq('order_date', orderDate)
    if (ids.length) q = q.not('id', 'in', `(${ids.join(',')})`)
    return q
  }
  const count = await query(true)
  if (count.error) throw new Error('Batch candidates unavailable')
  const total = count.count ?? 0
  const pages = lastPage(total, params.size)
  const pageHref = (page: number) => {
    const href = listHref('/replenishment/events/batches/new', handoffListSpec, params, { page })
    const url = new URL(href, 'http://localhost')
    ids.forEach((id) => url.searchParams.append('handoff', id))
    if (orderDate) url.searchParams.set('order_date', orderDate)
    return url.pathname + url.search
  }
  if (params.page > pages) redirect(pageHref(pages))
  const { from, to } = toRange(params.page, params.size)
  const range = nearestRange(from, to, total)
  const result = await query(false)
    .order('created_at', { ascending: range.reversed })
    .order('id', { ascending: !range.reversed })
    .range(range.from, range.to)
  if (result.error?.code === 'PGRST103') redirect(pageHref(1))
  if (result.error) throw new Error('Batch candidates unavailable')
  const rows = (range.reversed ? (result.data ?? []).toReversed() : (result.data ?? [])).map(
    (row) => rowSchema.parse(row),
  )
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('choose')}
        description={t('context')}
        help={<EventHandoffBatchesHelp />}
        actions={
          <Link className="underline" href="/replenishment/events/batches">
            {t('back')}
          </Link>
        }
      />
      <section aria-label={t('selection')} className="space-y-3 workspace-panel">
        <h2 className="text-section-title">{t('selectedCount', { total: ids.length })}</h2>
        {chosen.length !== ids.length && <p role="alert">{t('sourceInvalid')}</p>}
        <ul className="space-y-2">
          {ids.map((id) => {
            const row = chosen.find((item) => item.id === id)
            return (
              <li key={id} className="flex flex-wrap gap-3">
                <span className="break-words">
                  {row?.item_code ?? t('unavailable')}
                  {row && ` · ${row.event_name}`}
                </span>
                {row && (
                  <span>
                    {row.supplier_code} · {row.location_code} ·{' '}
                    {formatDateOnly(format, row.order_date)} · {row.currency}
                  </span>
                )}
                <Link
                  prefetch={false}
                  className="underline"
                  href={batchSelectionHref(ids.filter((value) => value !== id))}
                >
                  {t('removeLine', { item: row?.item_code ?? t('unavailable') })}
                </Link>
              </li>
            )
          })}
        </ul>
        <div className="flex flex-wrap gap-4">
          <Link className="underline" href="/replenishment/events/batches/new">
            {t('clear')}
          </Link>
          {ids.length > 0 && chosen.length === ids.length && (
            <Link
              className="underline"
              href={batchSelectionHref(ids, '/replenishment/events/batches/preview')}
            >
              {t('preview')}
            </Link>
          )}
        </div>
      </section>
      <EventHandoffBatchOverlap organizationId={context.active.id} handoffIds={ids} />
      <Form
        action="/replenishment/events/batches/new"
        className="workspace-toolbar flex flex-wrap items-end gap-3"
        key={JSON.stringify(params)}
      >
        {ids.map((id) => (
          <input key={id} type="hidden" name="handoff" value={id} />
        ))}
        <label className="grid min-w-0 max-w-full gap-1">
          {t('search')}
          <input
            name="q"
            defaultValue={params.q}
            maxLength={100}
            className="w-full min-w-0 max-w-full rounded-md border bg-background p-2"
          />
        </label>
        <label className="grid min-w-0 max-w-full gap-1">
          {t('supplier')}
          <input
            name="supplier"
            defaultValue={params.filters.supplier ?? ''}
            maxLength={64}
            className="w-full min-w-0 max-w-full rounded-md border bg-background p-2"
          />
        </label>
        <label className="grid min-w-0 max-w-full gap-1">
          {t('location')}
          <input
            name="location"
            defaultValue={params.filters.location ?? ''}
            maxLength={64}
            className="w-full min-w-0 max-w-full rounded-md border bg-background p-2"
          />
        </label>
        <label className="grid min-w-0 max-w-full gap-1">
          {t('orderDate')}
          <input
            type="date"
            name="order_date"
            defaultValue={orderDate}
            className="w-full min-w-0 max-w-full rounded-md border bg-background p-2"
          />
        </label>
        <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
          {t('filter')}
        </button>
      </Form>
      <p>{t('candidateNote')}</p>
      <Form
        action="/replenishment/events/batches/new"
        className="space-y-3"
        key={pageHref(params.page)}
      >
        {ids.map((id) => (
          <input key={id} type="hidden" name="handoff" value={id} />
        ))}
        <input type="hidden" name="q" value={params.q} />
        <input type="hidden" name="supplier" value={params.filters.supplier ?? ''} />
        <input type="hidden" name="location" value={params.filters.location ?? ''} />
        <input type="hidden" name="order_date" value={orderDate} />
        <TableScrollRegion label={t('candidates')} className="workspace-table">
          <table className="w-full min-w-[56rem] text-sm">
            <caption className="sr-only">{t('candidates')}</caption>
            <thead>
              <tr>
                {(
                  [
                    'select',
                    'item',
                    'supplier',
                    'location',
                    'orderDate',
                    'quantity',
                    'lineSubtotal',
                    'reuse',
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
                  <td className="p-2">
                    <input
                      type="checkbox"
                      name="handoff"
                      value={row.id}
                      disabled={ids.length >= 50}
                      aria-label={t('selectLine', { item: row.item_code })}
                    />
                  </td>
                  <th className="p-2 text-start">
                    <Link
                      prefetch={false}
                      className="underline"
                      href={`/replenishment/events/handoffs/${row.id}`}
                    >
                      {row.item_code}
                    </Link>
                    <p className="max-w-64 break-words font-normal text-muted-foreground">
                      {row.event_name}
                    </p>
                  </th>
                  <td className="p-2">{row.supplier_code}</td>
                  <td className="p-2">{row.location_code}</td>
                  <td className="p-2">{formatDateOnly(format, row.order_date)}</td>
                  <td className="p-2">
                    {formatCostDecimal(row.quantity, locale)} {row.unit}
                  </td>
                  <td className="p-2">
                    {formatPurchaseCost(row.subtotal, row.currency, row.minor_units, locale)}
                  </td>
                  <td className="p-2">{t('reuseCount', { total: row.batch_count })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollRegion>
        {!rows.length && <p>{t('noCandidates')}</p>}
        <button
          disabled={!rows.length || ids.length >= 50}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
        >
          {t('add')}
        </button>
      </Form>
      <nav aria-label={t('pagination')} className="flex gap-4">
        {params.page > 1 && (
          <Link className="underline" href={pageHref(params.page - 1)}>
            {t('previous')}
          </Link>
        )}
        <span>{t('page', { page: params.page, pages })}</span>
        {params.page < pages && (
          <Link className="underline" href={pageHref(params.page + 1)}>
            {t('next')}
          </Link>
        )}
      </nav>
    </div>
  )
}
