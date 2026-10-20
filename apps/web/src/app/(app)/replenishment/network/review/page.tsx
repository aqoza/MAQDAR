import { TableScrollRegion } from '@/components/table-scroll-region'
import { HelpDisclosure } from '@/components/help-disclosure'
import { PageHeader } from '@/components/page-header'
import { ReplenishmentNav } from '@/components/replenishment-nav'
import Form from 'next/form'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import {
  REVIEW_STATUSES,
  workbenchParams,
  workbenchRowSchema,
  workbenchSpec,
} from '@/lib/network-review'
import {
  lastPage,
  listHref,
  nearestRange,
  toRange,
  type RawSearchParams,
} from '@/lib/master-data/list-params'
import { searchPatterns } from '@/lib/master-data/search'

export async function generateMetadata() {
  const t = await getTranslations('NetworkReview')
  return { title: t('title') }
}

export default async function NetworkReview({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const params = workbenchParams(await searchParams)
  const [db, t] = await Promise.all([createClient(), getTranslations('NetworkReview')])
  const organizationId = context.active.id
  const query = (head: boolean) => {
    let q = db
      .from('network_review_list')
      .select('*', { count: 'exact', head })
      .eq('organization_id', organizationId)
    for (const pattern of searchPatterns(params.q)) q = q.like('search_text', pattern)
    if (params.filters.status) q = q.eq('status', params.filters.status)
    if (params.filters.source) q = q.eq('source_code', params.filters.source)
    if (params.filters.allocation) q = q.eq('allocation_id', params.filters.allocation)
    return q
  }
  const count = await query(true)
  if (count.error) throw new Error('Network review unavailable')
  const total = count.count ?? 0
  const pages = lastPage(total, params.size)
  const href = (page: number) =>
    listHref('/replenishment/network/review', workbenchSpec, params, { page })
  if (params.page > pages) redirect(href(pages))
  const { from, to } = toRange(params.page, params.size)
  const range = nearestRange(from, to, total)
  const ascending = params.dir === 'asc'
  const result = await query(false)
    .order('created_at', { ascending: range.reversed ? !ascending : ascending })
    .order('id', { ascending: !range.reversed })
    .range(range.from, range.to)
  if (result.error?.code === 'PGRST103') redirect(href(1))
  if (result.error) throw new Error('Network review unavailable')
  const rows = (range.reversed ? (result.data ?? []).toReversed() : (result.data ?? [])).map(
    (row) => workbenchRowSchema.parse(row),
  )
  return (
    <div className="min-w-0 space-y-4 wrap-anywhere">
      <PageHeader
        pattern="replenishment"
        navigation={<ReplenishmentNav current="network" />}
        title={t('title')}
        actions={
          <Link href="/replenishment/network/freight" className="underline">
            {t('chooseEstimate')}
          </Link>
        }
        description={t('context')}
        help={
          <HelpDisclosure>
            <p>{t('description')}</p>
          </HelpDisclosure>
        }
      />
      <Form
        action="/replenishment/network/review"
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
        {params.filters.allocation && (
          <input type="hidden" name="allocation" value={params.filters.allocation} />
        )}
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
        <Link href="/replenishment/network/review" className="underline">
          {t('reset')}
        </Link>
      </Form>
      <p>{t('count', { total })}</p>
      <TableScrollRegion label={t('title')}>
        <table className="w-full min-w-[50rem] text-sm">
          <caption className="sr-only">{t('title')}</caption>
          <thead>
            <tr>
              {(
                [
                  'item',
                  'sourceLocation',
                  'branches',
                  'dispatch',
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
                <th className="p-2 text-start whitespace-nowrap">{row.item_code}</th>
                <td className="p-2 whitespace-nowrap">{row.source_code}</td>
                <td className="p-2 tabular-nums">{row.branch_count}</td>
                <td className="p-2 whitespace-nowrap tabular-nums">{row.dispatch_date}</td>
                <td className="p-2 whitespace-nowrap">{t(`statuses.${row.status}`)}</td>
                <td className="p-2 whitespace-nowrap">{row.selected ? t('selected') : '—'}</td>
                <td className="p-2 whitespace-nowrap">
                  <Link
                    prefetch={false}
                    href={`/replenishment/network/review/${row.id}`}
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
