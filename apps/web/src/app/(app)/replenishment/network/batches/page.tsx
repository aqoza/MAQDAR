import { TableScrollRegion } from '@/components/table-scroll-region'
import { HelpDisclosure } from '@/components/help-disclosure'
import { PageHeader } from '@/components/page-header'
import { ReplenishmentNav } from '@/components/replenishment-nav'
import Form from 'next/form'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'
import { batchListParams, batchListSpec, batchRowSchema } from '@/lib/network-batches'
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

export default async function NetworkBatches({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const params = batchListParams(await searchParams)
  const [db, t, locale, format] = await Promise.all([
    createClient(),
    getTranslations('NetworkBatches'),
    getLocale(),
    getFormatter(),
  ])
  const query = (head: boolean) => {
    let q = db
      .from('network_handoff_batch_list')
      .select('*', { count: 'exact', head })
      .eq('organization_id', context.active!.id)
    for (const pattern of searchPatterns(params.q)) q = q.like('search_text', pattern)
    if (params.filters.source) q = q.eq('source_code', params.filters.source)
    if (params.filters.selection) q = q.eq('selection', params.filters.selection)
    return q
  }
  const count = await query(true)
  if (count.error) throw new Error('Batch list unavailable')
  const total = count.count ?? 0
  const pages = lastPage(total, params.size)
  const href = (page: number) =>
    listHref('/replenishment/network/batches', batchListSpec, params, { page })
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
    <div className="min-w-0 space-y-4 wrap-anywhere">
      <PageHeader
        pattern="replenishment"
        navigation={<ReplenishmentNav current="network" />}
        back={
          <Link className="underline" href="/replenishment/network/handoffs">
            {t('handoffs')}
          </Link>
        }
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
              href="/replenishment/network/batches/new"
            >
              {t('choose')}
            </Link>
          )
        }
      />
      <Form
        action="/replenishment/network/batches"
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
          {t('source')}
          <input
            name="source"
            maxLength={64}
            defaultValue={params.filters.source ?? ''}
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
            {(['current', 'historical', 'unavailable'] as const).map((key) => (
              <option key={key} value={key}>
                {t(key === 'unavailable' ? 'unavailableContext' : key)}
              </option>
            ))}
          </select>
        </label>
        <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
          {t('filter')}
        </button>
        <Link className="underline" href="/replenishment/network/batches">
          {t('reset')}
        </Link>
      </Form>
      <p>{t('count', { total })}</p>
      <TableScrollRegion label={t('title')}>
        <table className="w-full min-w-[60rem] text-sm wrap-normal">
          <caption className="sr-only">{t('title')}</caption>
          <thead>
            <tr>
              {(
                [
                  'saved',
                  'source',
                  'branches',
                  'dispatchDate',
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
                <td className="p-2">{row.source_code}</td>
                <td className="p-2">{row.branch_row_count}</td>
                <td className="p-2">{formatDateOnly(format, row.dispatch_date)}</td>
                <td className="p-2">{row.handoff_count}</td>
                <td className="p-2">
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
                <td className="p-2">
                  {t(row.selection === 'unavailable' ? 'unavailableContext' : row.selection)}
                </td>
                <td className="p-2">{row.overlap_count}</td>
                <td className="p-2">
                  <Link
                    className="underline"
                    prefetch={false}
                    href={`/replenishment/network/batches/${row.id}`}
                  >
                    {t('inspectBatch', { source: row.source_code })}
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
