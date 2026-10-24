import Link from 'next/link'
import Form from 'next/form'
import { redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { ReplenishmentNav } from '@/components/replenishment-nav'
import { HelpDisclosure } from '@/components/help-disclosure'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'
import { searchPatterns } from '@/lib/master-data/search'
import {
  lastPage,
  listHref,
  nearestRange,
  toRange,
  type RawSearchParams,
} from '@/lib/master-data/list-params'
import { returnHandoffsPath } from '@/lib/dealer-return-handoffs'
import {
  returnBatchesPath,
  returnBatchListSpec,
  returnBatchParams,
} from '@/lib/dealer-return-batches'

export default async function ReturnBatches({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const params = returnBatchParams(await searchParams)
  const [db, t, r, format] = await Promise.all([
    createClient(),
    getTranslations('DealerReturnBatches'),
    getTranslations('DealerReturns'),
    getFormatter(),
  ])
  const query = (head: boolean) => {
    let q = db
      .from('dealer_return_batch_list')
      .select(
        'id,created_at,source_code,location_code,requested_date,line_count,sources_available,overlap_count',
        { count: 'exact', head },
      )
      .eq('organization_id', context.active!.id)
    for (const pattern of searchPatterns(params.q)) q = q.like('search_text', pattern)
    return q
  }
  const count = await query(true)
  if (count.error) throw new Error('Return batches unavailable')
  const total = count.count ?? 0,
    pages = lastPage(total, params.size)
  const href = (page: number) => listHref(returnBatchesPath, returnBatchListSpec, params, { page })
  if (params.page > pages) redirect(href(pages))
  const { from, to } = toRange(params.page, params.size),
    range = nearestRange(from, to, total)
  const result = await query(false)
    .order('created_at', { ascending: range.reversed })
    .order('id', { ascending: !range.reversed })
    .range(range.from, range.to)
  if (result.error?.code === 'PGRST103') redirect(href(1))
  if (result.error) throw new Error('Return batches unavailable')
  const rows = range.reversed ? (result.data ?? []).toReversed() : (result.data ?? [])
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('title')}
        description={t('description')}
        navigation={<ReplenishmentNav current="returns" />}
        back={
          <Link className="underline" href={returnHandoffsPath}>
            {t('handoffs')}
          </Link>
        }
        actions={
          <>
            <Link
              className="inline-flex min-h-11 items-center underline md:min-h-0"
              href="/replenishment/returns/integrations"
            >
              {t('integrations')}
            </Link>
            {isEditorRole(context.role) ? (
              <Link className="underline" href={returnBatchesPath + '/new'}>
                {t('choose')}
              </Link>
            ) : undefined}
          </>
        }
        help={
          <HelpDisclosure>
            <p>{t('limits')}</p>
            <p>{t('retention')}</p>
          </HelpDisclosure>
        }
      />
      <Form
        key={JSON.stringify(params)}
        action={returnBatchesPath}
        className="workspace-toolbar flex flex-wrap items-end gap-3"
      >
        <label className="grid min-w-0 flex-1 basis-64 gap-1">
          {t('search')}
          <input
            name="q"
            maxLength={100}
            defaultValue={params.q}
            className="w-full min-w-0 rounded-md border bg-background p-2"
          />
        </label>
        <button className="min-h-11 rounded-md bg-primary px-3 py-2 text-primary-foreground">
          {r('apply')}
        </button>
        <Link className="inline-flex min-h-11 items-center underline" href={returnBatchesPath}>
          {r('reset')}
        </Link>
      </Form>
      <p role="status" className="text-sm text-muted-foreground">
        {t('count', { count: total })}
      </p>
      {rows.length ? (
        <TableScrollRegion label={t('title')}>
          <table className="w-full min-w-[55rem] text-sm">
            <caption className="sr-only">{t('title')}</caption>
            <thead>
              <tr>
                <th scope="col" className="p-2 text-start text-xs">
                  {t('saved')}
                </th>
                {(['source_code', 'location_code', 'requested_date'] as const).map((key) => (
                  <th scope="col" key={key} className="p-2 text-start text-xs">
                    {r(key)}
                  </th>
                ))}
                {(['lines', 'sourceContext', 'overlap'] as const).map((key) => (
                  <th scope="col" key={key} className="p-2 text-start text-xs">
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="p-2">
                    <Link
                      prefetch={false}
                      className="inline-flex min-h-11 items-center underline"
                      href={returnBatchesPath + '/' + row.id}
                    >
                      {format.dateTime(new Date(row.created_at!), 'long')}
                    </Link>
                  </td>
                  <td className="p-2">
                    <bdi>{row.source_code}</bdi>
                  </td>
                  <td className="p-2">
                    <bdi>{row.location_code}</bdi>
                  </td>
                  <td className="p-2">{row.requested_date}</td>
                  <td className="p-2">{row.line_count}</td>
                  <td className="p-2">
                    {t(row.sources_available ? 'available' : 'unavailableLabel')}
                  </td>
                  <td className="p-2">{row.overlap_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollRegion>
      ) : (
        <p className="workspace-panel">{t(params.q ? 'noMatches' : 'empty')}</p>
      )}
      {pages > 1 && (
        <nav aria-label={t('title')} className="flex flex-wrap items-center gap-4">
          <span>{r('page', { page: params.page, pages })}</span>
          {params.page > 1 && (
            <Link
              className="inline-flex min-h-11 items-center underline"
              href={href(params.page - 1)}
            >
              {r('previous')}
            </Link>
          )}
          {params.page < pages && (
            <Link
              className="inline-flex min-h-11 items-center underline"
              href={href(params.page + 1)}
            >
              {r('next')}
            </Link>
          )}
        </nav>
      )}
    </div>
  )
}
