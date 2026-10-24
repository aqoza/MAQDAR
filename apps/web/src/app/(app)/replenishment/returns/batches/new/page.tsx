import Link from 'next/link'
import Form from 'next/form'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { DealerReturnBatchOverlap } from '@/components/dealer-return-batch-overlap'
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
import { returnHandoffPayloadSchema } from '@/lib/dealer-return-handoffs'
import {
  batchInputSchema,
  batchSelection,
  returnBatchesPath,
  returnBatchListSpec,
  returnBatchParams,
  returnBatchSelectionHref,
} from '@/lib/dealer-return-batches'

export default async function ReturnBatchSelection({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  if (!isEditorRole(context.role)) redirect(returnBatchesPath)
  const [db, t, r, raw] = await Promise.all([
    createClient(),
    getTranslations('DealerReturnBatches'),
    getTranslations('DealerReturns'),
    searchParams,
  ])
  const ids = batchSelection(raw),
    params = returnBatchParams(raw),
    path = returnBatchesPath + '/new'
  if (ids.length && !batchInputSchema.safeParse(ids).success)
    return (
      <div className="space-y-3">
        <PageHeader
          pattern="replenishment"
          title={t('choose')}
          back={
            <Link className="underline" href={path}>
              {t('clear')}
            </Link>
          }
        />
        <p role="alert">{t('invalidSelection')}</p>
      </div>
    )
  const chosen = ids.length
    ? await db
        .from('dealer_return_handoffs')
        .select('id,payload')
        .eq('organization_id', context.active.id)
        .in('id', ids)
        .order('id')
    : { data: [], error: null }
  if (chosen.error) throw new Error('Return selection unavailable')
  const selected = (chosen.data ?? []).map((row) => ({
    id: row.id,
    payload: returnHandoffPayloadSchema.parse(row.payload),
  }))
  const query = (head: boolean) => {
    let q = db
      .from('dealer_return_batch_candidates')
      .select('id,created_at,payload,batch_count', { count: 'exact', head })
      .eq('organization_id', context.active!.id)
    for (const pattern of searchPatterns(params.q)) q = q.like('search_text', pattern)
    if (ids.length) q = q.not('id', 'in', `(${ids.join(',')})`)
    return q
  }
  const count = await query(true)
  if (count.error) throw new Error('Return candidates unavailable')
  const total = count.count ?? 0,
    pages = lastPage(total, params.size)
  const href = (page: number) => {
    const url = new URL(listHref(path, returnBatchListSpec, params, { page }), 'http://localhost')
    ids.forEach((id) => url.searchParams.append('handoff', id))
    return url.pathname + url.search
  }
  if (params.page > pages) redirect(href(pages))
  const { from, to } = toRange(params.page, params.size),
    range = nearestRange(from, to, total)
  const result = await query(false)
    .order('created_at', { ascending: range.reversed })
    .order('id', { ascending: !range.reversed })
    .range(range.from, range.to)
  if (result.error?.code === 'PGRST103') redirect(href(1))
  if (result.error) throw new Error('Return candidates unavailable')
  const rows = range.reversed ? (result.data ?? []).toReversed() : (result.data ?? [])
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('choose')}
        description={t('groupRule')}
        back={
          <Link className="underline" href={returnBatchesPath}>
            {t('title')}
          </Link>
        }
        help={
          <HelpDisclosure>
            <p>{t('limits')}</p>
            <p>{t('retention')}</p>
          </HelpDisclosure>
        }
      />
      <section aria-label={t('selection')} className="space-y-3 workspace-panel">
        <h2 className="text-section-title">{t('selectedCount', { count: ids.length })}</h2>
        {selected.length !== ids.length && <p role="alert">{t('unavailable')}</p>}
        <ul className="space-y-1">
          {ids.map((id) => {
            const v = selected.find((row) => row.id === id)?.payload.request.report
            return (
              <li key={id} className="flex flex-wrap items-center gap-3">
                <span className="break-words">
                  <bdi>{v?.item.code ?? t('unavailableLabel')}</bdi>
                  {v && (
                    <>
                      {' '}
                      ·{' '}
                      <bdi>
                        {v.source.code} → {v.receiver.code}
                      </bdi>{' '}
                      · {v.input.requested_date} ·{' '}
                      <bdi>
                        {v.input.quantity} {v.input.unit}
                      </bdi>
                    </>
                  )}
                </span>
                <Link
                  prefetch={false}
                  className="inline-flex min-h-11 items-center underline"
                  href={returnBatchSelectionHref(ids.filter((x) => x !== id))}
                >
                  {t('removeLine', { item: v?.item.code ?? t('unavailableLabel') })}
                </Link>
              </li>
            )
          })}
        </ul>
        <div className="flex flex-wrap gap-4">
          <Link className="inline-flex min-h-11 items-center underline" href={path}>
            {t('clear')}
          </Link>
          {ids.length > 0 && selected.length === ids.length && (
            <Link
              className="inline-flex min-h-11 items-center underline"
              href={returnBatchSelectionHref(ids, returnBatchesPath + '/preview')}
            >
              {t('preview')}
            </Link>
          )}
        </div>
      </section>
      <DealerReturnBatchOverlap organizationId={context.active.id} handoffIds={ids} />
      <Form
        key={JSON.stringify(params)}
        action={path}
        className="workspace-toolbar flex flex-wrap items-end gap-3"
      >
        {ids.map((id) => (
          <input key={id} type="hidden" name="handoff" value={id} />
        ))}
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
        <Link
          className="inline-flex min-h-11 items-center underline"
          href={returnBatchSelectionHref(ids)}
        >
          {r('reset')}
        </Link>
      </Form>
      <p role="status" className="text-sm text-muted-foreground">
        {t('candidateCount', { count: total })}
      </p>
      <Form key={href(params.page)} action={path} className="space-y-3">
        {ids.map((id) => (
          <input key={id} type="hidden" name="handoff" value={id} />
        ))}
        <input type="hidden" name="q" value={params.q} />
        {rows.length ? (
          <TableScrollRegion label={t('candidates')}>
            <table className="w-full min-w-[58rem] text-sm">
              <caption className="sr-only">{t('candidates')}</caption>
              <thead>
                <tr>
                  <th scope="col" className="p-2 text-start text-xs">
                    {t('select')}
                  </th>
                  {(
                    [
                      'item_code',
                      'source_code',
                      'location_code',
                      'requested_date',
                      'quantity',
                      'condition',
                    ] as const
                  ).map((key) => (
                    <th scope="col" key={key} className="p-2 text-start text-xs">
                      {r(key)}
                    </th>
                  ))}
                  <th scope="col" className="p-2 text-start text-xs">
                    {t('reuse')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const v = returnHandoffPayloadSchema.parse(row.payload).request.report
                  return (
                    <tr key={row.id} className="border-t">
                      <td className="p-2">
                        <label className="inline-flex min-h-11 min-w-11 items-center justify-center">
                          <span className="sr-only">{t('selectLine', { item: v.item.code })}</span>
                          <input
                            type="checkbox"
                            name="handoff"
                            value={row.id!}
                            disabled={ids.length >= 50}
                          />
                        </label>
                      </td>
                      <td className="p-2">
                        <bdi>{v.item.code}</bdi>
                      </td>
                      <td className="p-2">
                        <bdi>{v.source.code}</bdi>
                      </td>
                      <td className="p-2">
                        <bdi>{v.receiver.code}</bdi>
                      </td>
                      <td className="p-2">{v.input.requested_date}</td>
                      <td className="whitespace-nowrap p-2">
                        <bdi>
                          {v.input.quantity} {v.input.unit}
                        </bdi>
                      </td>
                      <td className="p-2">{r(v.input.condition)}</td>
                      <td className="p-2">{row.batch_count}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </TableScrollRegion>
        ) : (
          <p className="workspace-panel">{t(params.q ? 'noCandidatesMatch' : 'noCandidates')}</p>
        )}
        {rows.length > 0 && (
          <button
            disabled={ids.length >= 50}
            className="min-h-11 rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
          >
            {t('add')}
          </button>
        )}
      </Form>
      {pages > 1 && (
        <nav aria-label={t('candidates')} className="flex flex-wrap items-center gap-4">
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
