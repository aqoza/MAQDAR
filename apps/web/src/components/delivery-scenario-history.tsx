import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { deliveryScenarioStatuses } from '@/lib/delivery-scenarios'
import {
  lastPage,
  nearestRange,
  parseListParams,
  toRange,
  type RawSearchParams,
} from '@/lib/master-data/list-params'

export async function DeliveryScenarioHistory({
  organizationId,
  scenarioId,
  raw,
}: {
  organizationId: string
  scenarioId: string
  raw: RawSearchParams
}) {
  const [db, t] = await Promise.all([createClient(), getTranslations('DeliveryScenarios')])
  const params = parseListParams(
    { page: raw.deliveriesPage },
    {
      sorts: ['created_at'],
      defaultSort: 'created_at',
      defaultDir: 'desc',
      tiebreak: 'id',
      filters: [],
      search: false,
    },
  )
  const query = (head: boolean) =>
    db
      .from('delivery_scenario_list')
      .select('*', { count: 'exact', head })
      .eq('organization_id', organizationId)
      .eq('supplier_scenario_id', scenarioId)
  const count = await query(true)
  if (count.error) throw new Error('Delivery scenarios unavailable')
  const total = count.count ?? 0
  const pages = lastPage(total, params.size)
  const href = (page: number) => `/replenishment/suppliers/${scenarioId}?deliveriesPage=${page}`
  if (params.page > pages) redirect(href(pages))
  const { from, to } = toRange(params.page, params.size)
  const range = nearestRange(from, to, total)
  const result = await query(false)
    .order('created_at', { ascending: range.reversed })
    .order('id', { ascending: !range.reversed })
    .range(range.from, range.to)
  if (result.error?.code === 'PGRST103') redirect(href(1))
  if (result.error) throw new Error('Delivery scenarios unavailable')
  const rows = range.reversed ? (result.data ?? []).toReversed() : (result.data ?? [])
  return (
    <section className="space-y-3" aria-label={t('history')}>
      <h2 className="text-section-title">{t('history')}</h2>
      <p>{t('count', { total })}</p>
      <div className="workspace-table overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('history')}</caption>
          <thead>
            <tr>
              {(['requested', 'result', 'orderDate', 'receiptDate', 'inspect'] as const).map(
                (k) => (
                  <th className="p-2 text-start" key={k}>
                    {t(k)}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className="border-t" key={row.id}>
                <th className="p-2 text-start">{row.requested_date}</th>
                <td className="p-2">
                  {t(`statuses.${z.enum(deliveryScenarioStatuses).parse(row.status)}`)}
                </td>
                <td className="p-2 tabular-nums">{row.order_date ?? '—'}</td>
                <td className="p-2 tabular-nums">{row.receipt_date ?? '—'}</td>
                <td className="p-2">
                  <Link
                    prefetch={false}
                    className="underline"
                    href={`/replenishment/deliveries/${row.id}`}
                  >
                    {t('inspectRequested', { date: row.requested_date ?? '—' })}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
    </section>
  )
}
