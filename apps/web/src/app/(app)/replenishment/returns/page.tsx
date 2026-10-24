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
import { listHref, lastPage, type RawSearchParams } from '@/lib/master-data/list-params'
import {
  dealerReturnsPath,
  dealerReturnListSpec,
  dealerReturnParams,
  dealerReturnReportSchema,
} from '@/lib/dealer-returns'
export default async function DealerReturns({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const params = dealerReturnParams(await searchParams)
  const [db, t, format] = await Promise.all([
    createClient(),
    getTranslations('DealerReturns'),
    getFormatter(),
  ])
  const base = () => {
    let query = db
      .from('dealer_return_requests')
      .select('id,report,created_at,withdrawn_at', { count: 'exact' })
      .eq('organization_id', context.active!.id)
    for (const pattern of searchPatterns(params.q)) query = query.like('search_text', pattern)
    if (params.filters.status === 'requested') query = query.is('withdrawn_at', null)
    if (params.filters.status === 'withdrawn') query = query.not('withdrawn_at', 'is', null)
    return query
  }
  const count = await base().limit(0)
  if (count.error) throw new Error('Return history unavailable')
  const total = count.count ?? 0
  const pages = lastPage(total, params.size)
  const href = (page: number) => listHref(dealerReturnsPath, dealerReturnListSpec, params, { page })
  if (params.page > pages) redirect(href(pages))
  const result = await base()
    .order('created_at', { ascending: false })
    .order('id')
    .range((params.page - 1) * params.size, params.page * params.size - 1)
  if (result.error) throw new Error('Return history unavailable')
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('title')}
        description={t('description')}
        navigation={<ReplenishmentNav current="returns" />}
        actions={
          isEditorRole(context.role) ? (
            <Link href={`${dealerReturnsPath}/new`} className="underline">
              {t('new')}
            </Link>
          ) : undefined
        }
        help={
          <HelpDisclosure>
            <p>{t('limits')}</p>
            <p>{t('corrections')}</p>
          </HelpDisclosure>
        }
      />
      <Form
        key={JSON.stringify(params)}
        action={dealerReturnsPath}
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
        <label className="grid gap-1">
          {t('status')}
          <select
            name="status"
            defaultValue={params.filters.status ?? ''}
            className="rounded-md border bg-background p-2"
          >
            <option value="">{t('all')}</option>
            {(['requested', 'withdrawn'] as const).map((s) => (
              <option key={s} value={s}>
                {t(s)}
              </option>
            ))}
          </select>
        </label>
        <button className="min-h-11 rounded-md bg-primary px-3 py-2 text-primary-foreground">
          {t('apply')}
        </button>
        <Link href={dealerReturnsPath} className="inline-flex min-h-11 items-center underline">
          {t('reset')}
        </Link>
      </Form>
      <p role="status" className="text-sm text-muted-foreground">
        {t('count', { count: total })}
      </p>
      {result.data.length ? (
        <TableScrollRegion label={t('title')}>
          <table className="w-full min-w-[56rem] text-sm">
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
                    'status',
                    'created',
                  ] as const
                ).map((key) => (
                  <th key={key} className="p-2 text-start text-xs">
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.data.map((row) => {
                const r = dealerReturnReportSchema.parse(row.report)
                return (
                  <tr key={row.id} className="border-t">
                    <td className="whitespace-nowrap p-2">
                      <Link
                        href={`${dealerReturnsPath}/${row.id}`}
                        className="inline-flex min-h-11 items-center underline"
                      >
                        <bdi>{r.item.code}</bdi>
                      </Link>
                    </td>
                    <td className="whitespace-nowrap p-2">
                      <bdi>{r.source.code}</bdi>
                    </td>
                    <td className="whitespace-nowrap p-2">
                      <bdi>{r.receiver.code}</bdi>
                    </td>
                    <td className="whitespace-nowrap p-2">
                      <bdi>
                        {r.input.quantity} {r.input.unit}
                      </bdi>
                    </td>
                    <td className="whitespace-nowrap p-2">{r.input.requested_date}</td>
                    <td className="p-2">{t(r.input.condition)}</td>
                    <td className="p-2">{t(row.withdrawn_at ? 'withdrawn' : 'requested')}</td>
                    <td className="whitespace-nowrap p-2 text-xs">
                      {format.dateTime(new Date(row.created_at), 'long')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </TableScrollRegion>
      ) : (
        <p className="workspace-panel">
          {t(params.q || params.filters.status ? 'noMatches' : 'empty')}
        </p>
      )}
      {pages > 1 && (
        <nav aria-label={t('title')} className="flex flex-wrap items-center gap-4">
          <span>{t('page', { page: params.page, pages })}</span>
          {params.page > 1 && (
            <Link
              className="inline-flex min-h-11 items-center underline"
              href={href(params.page - 1)}
            >
              {t('previous')}
            </Link>
          )}
          {params.page < pages && (
            <Link
              className="inline-flex min-h-11 items-center underline"
              href={href(params.page + 1)}
            >
              {t('next')}
            </Link>
          )}
        </nav>
      )}
    </div>
  )
}
