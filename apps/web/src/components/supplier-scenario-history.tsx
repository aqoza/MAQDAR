import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { formatScore } from '@/lib/forecast-quality'
import { supplierScenarioStatuses } from '@/lib/supplier-scenarios'
import {
  lastPage,
  nearestRange,
  parseListParams,
  toRange,
  type RawSearchParams,
} from '@/lib/master-data/list-params'

export async function SupplierScenarioHistory({
  organizationId,
  draftId,
  locale,
  raw,
}: {
  organizationId: string
  draftId: string
  locale: string
  raw: RawSearchParams
}) {
  const [db, t] = await Promise.all([createClient(), getTranslations('SupplierScenarios')])
  const params = parseListParams(
    { page: raw.scenariosPage },
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
      .from('supplier_scenario_list')
      .select('*', { count: 'exact', head })
      .eq('organization_id', organizationId)
      .eq('draft_id', draftId)
  const count = await query(true)
  if (count.error) throw new Error('Supplier scenarios unavailable')
  const total = count.count ?? 0
  const pages = lastPage(total, params.size)
  const href = (page: number) => `/replenishment/${draftId}?scenariosPage=${page}`
  if (params.page > pages) redirect(href(pages))
  const { from, to } = toRange(params.page, params.size)
  const range = nearestRange(from, to, total)
  const result = await query(false)
    .order('created_at', { ascending: range.reversed })
    .order('id', { ascending: !range.reversed })
    .range(range.from, range.to)
  if (result.error?.code === 'PGRST103') redirect(href(1))
  if (result.error) throw new Error('Supplier scenarios unavailable')
  const rows = range.reversed ? (result.data ?? []).toReversed() : (result.data ?? [])
  return (
    <section className="space-y-3" aria-label={t('history')}>
      <h2 className="text-section-title">{t('history')}</h2>
      <p>{t('count', { total })}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('history')}</caption>
          <thead>
            <tr>
              {(['supplier', 'result', 'quantity', 'overage', 'inspect'] as const).map((k) => (
                <th className="p-2 text-start" key={k}>
                  {t(k)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className="border-t" key={row.id}>
                <th className="p-2 text-start">{row.supplier_code}</th>
                <td className="p-2">
                  {t(`statuses.${z.enum(supplierScenarioStatuses).parse(row.status)}`)}
                </td>
                <td className="p-2 tabular-nums">
                  {formatScore(row.quantity, locale)} {row.unit ?? '—'}
                </td>
                <td className="p-2 tabular-nums">
                  {formatScore(row.overage, locale)} {row.unit ?? '—'}
                </td>
                <td className="p-2">
                  <Link
                    prefetch={false}
                    className="underline"
                    href={`/replenishment/suppliers/${row.id}`}
                  >
                    {t('inspectSupplier', { supplier: row.supplier_code ?? '—' })}
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
