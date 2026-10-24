import Link from 'next/link'
import Form from 'next/form'
import { redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { ReplenishmentNav } from '@/components/replenishment-nav'
import { HelpDisclosure } from '@/components/help-disclosure'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { searchPatterns } from '@/lib/master-data/search'
import {
  listHref,
  lastPage,
  nearestRange,
  toRange,
  type RawSearchParams,
} from '@/lib/master-data/list-params'
import { dealerReturnsPath } from '@/lib/dealer-returns'
import {
  returnHandoffsPath,
  returnHandoffParams,
  returnHandoffListSpec,
  returnHandoffPayloadSchema,
} from '@/lib/dealer-return-handoffs'

export default async function ReturnHandoffs({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const params = returnHandoffParams(await searchParams)
  const [db, t, r, format] = await Promise.all([
    createClient(),
    getTranslations('DealerReturnHandoffs'),
    getTranslations('DealerReturns'),
    getFormatter(),
  ])
  const query = (head: boolean) => {
    let q = db
      .from('dealer_return_handoffs')
      .select('id,created_at,payload', { count: 'exact', head })
      .eq('organization_id', context.active!.id)
    for (const pattern of searchPatterns(params.q)) q = q.like('search_text', pattern)
    return q
  }
  const count = await query(true)
  if (count.error) throw new Error('Return handoff history unavailable')
  const total = count.count ?? 0
  const pages = lastPage(total, params.size)
  const href = (page: number) =>
    listHref(returnHandoffsPath, returnHandoffListSpec, params, { page })
  if (params.page > pages) redirect(href(pages))
  const { from, to } = toRange(params.page, params.size)
  const range = nearestRange(from, to, total)
  const result = await query(false)
    .order('created_at', { ascending: range.reversed })
    .order('id', { ascending: !range.reversed })
    .range(range.from, range.to)
  if (result.error?.code === 'PGRST103') redirect(href(1))
  if (result.error) throw new Error('Return handoff history unavailable')
  const rows = range.reversed ? (result.data ?? []).toReversed() : (result.data ?? [])
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('title')}
        description={t('description')}
        navigation={<ReplenishmentNav current="returns" />}
        back={
          <Link href={dealerReturnsPath} className="underline">
            {r('title')}
          </Link>
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
        action={returnHandoffsPath}
        className="workspace-toolbar flex flex-wrap items-end gap-3"
      >
        <label className="grid min-w-0 flex-1 basis-64 gap-1">
          {t('search')}
          <input
            name="q"
            defaultValue={params.q}
            maxLength={100}
            className="w-full min-w-0 rounded-md border bg-background p-2"
          />
        </label>
        <button className="min-h-11 rounded-md bg-primary px-3 py-2 text-primary-foreground">
          {r('apply')}
        </button>
        <Link href={returnHandoffsPath} className="inline-flex min-h-11 items-center underline">
          {r('reset')}
        </Link>
      </Form>
      <p role="status" className="text-sm text-muted-foreground">
        {t('count', { count: total })}
      </p>
      {rows.length ? (
        <TableScrollRegion label={t('title')}>
          <table className="w-full min-w-[52rem] text-sm">
            <caption className="sr-only">{t('title')}</caption>
            <thead>
              <tr>
                {(
                  [
                    'item_code',
                    'source_code',
                    'location_code',
                    'quantity',
                    'requested_date',
                    'condition',
                    'created',
                  ] as const
                ).map((key) => (
                  <th key={key} className="p-2 text-start text-xs">
                    {key === 'created' ? t('created') : r(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const p = returnHandoffPayloadSchema.parse(row.payload)
                const v = p.request.report
                return (
                  <tr key={row.id} className="border-t">
                    <td className="p-2">
                      <Link
                        className="inline-flex min-h-11 items-center underline"
                        href={returnHandoffsPath + '/' + row.id}
                      >
                        <bdi>{v.item.code}</bdi>
                      </Link>
                    </td>
                    <td className="p-2">
                      <bdi>{v.source.code}</bdi>
                    </td>
                    <td className="p-2">
                      <bdi>{v.receiver.code}</bdi>
                    </td>
                    <td className="whitespace-nowrap p-2">
                      <bdi>
                        {v.input.quantity} {v.input.unit}
                      </bdi>
                    </td>
                    <td className="whitespace-nowrap p-2">{v.input.requested_date}</td>
                    <td className="p-2">{r(v.input.condition)}</td>
                    <td className="p-2 text-xs">
                      {format.dateTime(new Date(row.created_at), 'long')}
                    </td>
                  </tr>
                )
              })}
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
