import Form from 'next/form'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { ReplenishmentNav } from '@/components/replenishment-nav'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { ExcessDispositionHandoffsHelp } from '@/components/excess-disposition-handoffs-help'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { DISPOSITION_KINDS } from '@/lib/excess-disposition'
import {
  handoffListParams,
  handoffListSpec,
  handoffRowSchema,
} from '@/lib/excess-disposition-handoffs'
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
  return { title: (await getTranslations('ExcessDispositionHandoffs'))('title') }
}
export default async function Handoffs({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const bt = await getTranslations('ExcessDispositionBatches')
  const org = context.active.id
  const params = handoffListParams(await searchParams)
  const [db, t, dt, locale, format] = await Promise.all([
    createClient(),
    getTranslations('ExcessDispositionHandoffs'),
    getTranslations('ExcessDisposition'),
    getLocale(),
    getFormatter(),
  ])
  const query = (head: boolean) => {
    let q = db
      .from('excess_disposition_handoff_list')
      .select('*', { count: 'exact', head })
      .eq('organization_id', org)
    for (const pattern of searchPatterns(params.q)) q = q.like('search_text', pattern)
    if (params.filters.location) q = q.eq('location_code', params.filters.location)
    if (params.filters.kind) q = q.eq('kind', params.filters.kind)
    if (params.filters.selection) q = q.eq('selected', params.filters.selection === 'current')
    if (params.filters.assessment) q = q.eq('assessment_id', params.filters.assessment)
    if (params.filters.item) q = q.eq('item_id', params.filters.item)
    return q
  }
  const count = await query(true)
  if (count.error) throw new Error('Disposition handoff history unavailable')
  const total = count.count ?? 0
  const pages = lastPage(total, params.size)
  const href = (page: number) =>
    listHref('/replenishment/excess/handoffs', handoffListSpec, params, { page })
  if (params.page > pages) redirect(href(pages))
  const { from, to } = toRange(params.page, params.size)
  const range = nearestRange(from, to, total)
  const ascending = params.dir === 'asc'
  const result = await query(false)
    .order('created_at', { ascending: range.reversed ? !ascending : ascending })
    .order('id', { ascending: !range.reversed })
    .range(range.from, range.to)
  if (result.error?.code === 'PGRST103') redirect(href(1))
  if (result.error) throw new Error('Disposition handoff history unavailable')
  const rows = (range.reversed ? (result.data ?? []).toReversed() : (result.data ?? [])).map(
    (row) => handoffRowSchema.parse(row),
  )
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="replenishment"
        navigation={<ReplenishmentNav current="excess" />}
        title={t('title')}
        description={t('context')}
        help={<ExcessDispositionHandoffsHelp />}
        actions={
          <Link
            className="rounded-md border bg-background px-3 py-2"
            href="/replenishment/excess/batches"
          >
            {bt('title')}
          </Link>
        }
        back={
          <Link className="underline" href="/replenishment/excess/review">
            {t('review')}
          </Link>
        }
      />
      <Form
        action="/replenishment/excess/handoffs"
        className="workspace-toolbar flex flex-wrap items-end gap-3"
        key={JSON.stringify(params)}
      >
        {(['assessment', 'item'] as const).map(
          (key) =>
            params.filters[key] && (
              <input key={key} type="hidden" name={key} value={params.filters[key]} />
            ),
        )}
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
          {t('kind')}
          <select
            name="kind"
            defaultValue={params.filters.kind ?? ''}
            className="rounded-md border bg-background p-2"
          >
            <option value="">{t('all')}</option>
            {DISPOSITION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {dt(`kinds.${kind}`)}
              </option>
            ))}
          </select>
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
        <label className="grid gap-1">
          {t('pageSize')}
          <select
            name="size"
            defaultValue={params.size}
            className="rounded-md border bg-background p-2"
          >
            {[25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
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
        <Link href="/replenishment/excess/handoffs" className="underline">
          {t('reset')}
        </Link>
      </Form>
      <p>{t('count', { total })}</p>
      <TableScrollRegion label={t('title')} className="workspace-table">
        <table className="w-full min-w-[60rem] text-sm">
          <caption className="sr-only">{t('title')}</caption>
          <thead>
            <tr>
              {(
                [
                  'item',
                  'location',
                  'kind',
                  'quantity',
                  'referenceValue',
                  'cutoff',
                  'created',
                  'selection',
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
                  <bdi>{row.item_code}</bdi>
                </th>
                <td className="p-2">
                  <bdi>{row.location_code}</bdi>
                </td>
                <td className="p-2">{dt(`kinds.${row.kind}`)}</td>
                <td className="p-2">
                  <bdi>
                    {formatCostDecimal(row.quantity, locale, 100)} {row.unit}
                  </bdi>
                </td>
                <td className="p-2">
                  <bdi>
                    {formatCostDecimal(row.reference_value, locale, 100)} {row.currency}
                  </bdi>
                </td>
                <td className="p-2">
                  {format.dateTime(new Date(row.cutoff), { dateStyle: 'medium', timeZone: 'UTC' })}
                </td>
                <td className="p-2">{format.dateTime(new Date(row.created_at), 'long')}</td>
                <td className="p-2">{t(row.selected ? 'current' : 'historical')}</td>
                <td className="p-2">
                  <Link
                    prefetch={false}
                    className="underline"
                    href={`/replenishment/excess/handoffs/${row.id}`}
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
