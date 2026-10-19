import Form from 'next/form'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { ReplenishmentNav } from '@/components/replenishment-nav'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { ExcessDispositionHelp } from '@/components/excess-disposition-help'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import {
  DISPOSITION_KINDS,
  REVIEW_STATUSES,
  dispositionRowSchema,
  dispositionListParams,
  dispositionListSpec,
} from '@/lib/excess-disposition'
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
  return { title: (await getTranslations('ExcessDisposition'))('title') }
}
export default async function Dispositions({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const ht = await getTranslations('ExcessDispositionHandoffs')
  const params = dispositionListParams(await searchParams)
  const [db, t, locale, format] = await Promise.all([
    createClient(),
    getTranslations('ExcessDisposition'),
    getLocale(),
    getFormatter(),
  ])
  const query = (head: boolean) => {
    let q = db
      .from('excess_disposition_list')
      .select('*', { count: 'exact', head })
      .eq('organization_id', context.active!.id)
    for (const pattern of searchPatterns(params.q)) q = q.like('search_text', pattern)
    if (params.filters.location) q = q.eq('location_code', params.filters.location)
    if (params.filters.kind) q = q.eq('kind', params.filters.kind)
    if (params.filters.status) q = q.eq('status', params.filters.status)
    if (params.filters.assessment) q = q.eq('assessment_id', params.filters.assessment)
    if (params.filters.item) q = q.eq('item_id', params.filters.item)
    return q
  }
  const count = await query(true)
  if (count.error) throw new Error('Disposition history unavailable')
  const total = count.count ?? 0
  const pages = lastPage(total, params.size)
  const href = (page: number) =>
    listHref('/replenishment/excess/review', dispositionListSpec, params, { page })
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
  if (result.error) throw new Error('Disposition history unavailable')
  const rows = (range.reversed ? result.data.toReversed() : result.data).map((row) =>
    dispositionRowSchema.parse(row),
  )
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('title')}
        description={t('context')}
        navigation={<ReplenishmentNav current="excess" />}
        help={<ExcessDispositionHelp />}
        actions={
          <Link
            className="rounded-md border bg-background px-3 py-2"
            href="/replenishment/excess/handoffs"
          >
            {ht('title')}
          </Link>
        }
        back={
          <Link href="/replenishment/excess" className="underline">
            {t('assessments')}
          </Link>
        }
      />
      <Form
        action="/replenishment/excess/review"
        key={JSON.stringify(params)}
        className="workspace-toolbar flex flex-wrap items-end gap-3"
      >
        <label className="grid min-w-0 gap-1">
          {t('search')}
          <input
            name="q"
            maxLength={100}
            defaultValue={params.q}
            className="min-w-0 rounded-md border bg-background p-2"
          />
        </label>
        <label className="grid min-w-0 gap-1">
          {t('location')}
          <input
            name="location"
            maxLength={64}
            defaultValue={params.filters.location ?? ''}
            className="min-w-0 rounded-md border bg-background p-2"
          />
        </label>
        {(['assessment', 'item'] as const).map(
          (key) =>
            params.filters[key] && (
              <input key={key} type="hidden" name={key} value={params.filters[key]} />
            ),
        )}
        <label className="grid gap-1">
          {t('kind')}
          <select
            name="kind"
            defaultValue={params.filters.kind ?? ''}
            className="rounded-md border bg-background p-2"
          >
            <option value="">{t('all')}</option>
            {DISPOSITION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`kinds.${kind}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          {t('status')}
          <select
            name="status"
            defaultValue={params.filters.status ?? ''}
            className="rounded-md border bg-background p-2"
          >
            <option value="">{t('all')}</option>
            {REVIEW_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`statuses.${status}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          {t('size')}
          <select
            name="size"
            defaultValue={params.size}
            className="rounded-md border bg-background p-2"
          >
            {[25, 50, 100].map((size) => (
              <option key={size}>{size}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          {t('sort')}
          <select
            name="dir"
            defaultValue={params.dir}
            className="rounded-md border bg-background p-2"
          >
            <option value="desc">{t('newest')}</option>
            <option value="asc">{t('oldest')}</option>
          </select>
        </label>
        <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
          {t('filter')}
        </button>
        <Link className="underline" href="/replenishment/excess/review">
          {t('reset')}
        </Link>
      </Form>
      <p>{t('count', { total })}</p>
      <TableScrollRegion label={t('title')}>
        <table className="w-full min-w-[60rem] text-sm">
          <thead>
            <tr>
              {(
                [
                  'item',
                  'location',
                  'kind',
                  'quantity',
                  'referenceValue',
                  'status',
                  'selection',
                  'inspect',
                ] as const
              ).map((key) => (
                <th key={key} className="p-3 text-start text-xs font-medium">
                  {t(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t align-top">
                <th className="p-3 text-start font-medium">
                  <bdi>{row.item_code}</bdi>
                  <p className="text-xs font-normal">
                    {format.dateTime(new Date(row.created_at), 'long')}
                  </p>
                </th>
                <td className="p-3">
                  <bdi>{row.location_code}</bdi>
                </td>
                <td className="p-3">{t(`kinds.${row.kind}`)}</td>
                <td className="whitespace-nowrap p-3 tabular-nums">
                  <bdi>
                    {formatCostDecimal(row.quantity, locale, 100)} {row.unit}
                  </bdi>
                </td>
                <td className="whitespace-nowrap p-3 tabular-nums">
                  <bdi>
                    {formatCostDecimal(row.reference_value, locale, 100)} {row.currency}
                  </bdi>
                </td>
                <td className="p-3">
                  {t(`statuses.${row.status}`)}
                  <p className="text-xs">{t('revision', { revision: row.revision })}</p>
                </td>
                <td className="p-3">
                  {row.selected ? t('selected') : row.status === 'approved' ? t('historical') : '—'}
                </td>
                <td className="p-3">
                  <Link
                    prefetch={false}
                    href={`/replenishment/excess/review/${row.id}`}
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
