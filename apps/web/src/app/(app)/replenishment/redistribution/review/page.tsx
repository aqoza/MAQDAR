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
import {
  REVIEW_STATUSES,
  workbenchParams,
  workbenchRowSchema,
  workbenchSpec,
} from '@/lib/transfer-review'
import {
  lastPage,
  listHref,
  nearestRange,
  toRange,
  type RawSearchParams,
} from '@/lib/master-data/list-params'
import { searchPatterns } from '@/lib/master-data/search'

export async function generateMetadata() {
  const t = await getTranslations('TransferReview')
  return { title: t('title') }
}

export default async function TransferReview({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const params = workbenchParams(await searchParams)
  const [db, t, locale, handoffT] = await Promise.all([
    createClient(),
    getTranslations('TransferReview'),
    getLocale(),
    getTranslations('TransferHandoffs'),
  ])
  const organizationId = context.active.id
  const query = (head: boolean) => {
    let q = db
      .from('transfer_review_list')
      .select('*', { count: 'exact', head })
      .eq('organization_id', organizationId)
    for (const pattern of searchPatterns(params.q)) q = q.like('search_text', pattern)
    if (params.filters.location) q = q.eq('location_code', params.filters.location)
    if (params.filters.status) q = q.eq('status', params.filters.status)
    if (params.filters.source) q = q.eq('source_code', params.filters.source)
    if (params.filters.draft) q = q.eq('draft_id', params.filters.draft)
    return q
  }
  const count = await query(true)
  if (count.error) throw new Error('Transfer review unavailable')
  const total = count.count ?? 0
  const pages = lastPage(total, params.size)
  const href = (page: number) =>
    listHref('/replenishment/redistribution/review', workbenchSpec, params, { page })
  if (params.page > pages) redirect(href(pages))
  const { from, to } = toRange(params.page, params.size)
  const range = nearestRange(from, to, total)
  const ascending = params.dir === 'asc'
  const result = await query(false)
    .order('created_at', { ascending: range.reversed ? !ascending : ascending })
    .order('id', { ascending: !range.reversed })
    .range(range.from, range.to)
  if (result.error?.code === 'PGRST103') redirect(href(1))
  if (result.error) throw new Error('Transfer review unavailable')
  const rows = (range.reversed ? (result.data ?? []).toReversed() : (result.data ?? [])).map(
    (row) => workbenchRowSchema.parse(row),
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
      <Link href="/replenishment/redistribution/handoffs" className="inline-block underline">
        {handoffT('title')}
      </Link>
      <Form
        action="/replenishment/redistribution/review"
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
        {params.filters.draft && <input type="hidden" name="draft" value={params.filters.draft} />}
        <label className="grid min-w-0 gap-1">
          {t('sourceLocation')}
          <input
            name="source"
            maxLength={64}
            defaultValue={params.filters.source ?? ''}
            className="w-full min-w-0 rounded-md border bg-background p-2"
          />
        </label>
        <label className="grid min-w-0 gap-1">
          {t('status')}
          <select
            name="status"
            defaultValue={params.filters.status ?? ''}
            className="w-full min-w-0 rounded-md border bg-background p-2"
          >
            <option value="">{t('all')}</option>
            {REVIEW_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`statuses.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
          {t('filter')}
        </button>
        <Link href="/replenishment/redistribution/review" className="underline">
          {t('reset')}
        </Link>
      </Form>
      <p>{t('count', { total })}</p>
      <TableScrollRegion label={t('title')}>
        <table className="w-full min-w-[64rem] text-sm">
          <caption className="sr-only">{t('title')}</caption>
          <thead>
            <tr>
              {(
                [
                  'item',
                  'location',
                  'sourceLocation',
                  'quantity',
                  'subtotal',
                  'status',
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
                <td className="p-2 whitespace-nowrap">{t(`statuses.${row.status}`)}</td>
                <td className="p-2 whitespace-nowrap">{row.selected ? t('selected') : '—'}</td>
                <td className="p-2">
                  <Link
                    prefetch={false}
                    href={`/replenishment/redistribution/review/${row.id}`}
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
