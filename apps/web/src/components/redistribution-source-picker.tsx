import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import {
  lastPage,
  nearestRange,
  toRange,
  type RawSearchParams,
} from '@/lib/master-data/list-params'
import { redistributionListParams } from '@/lib/redistribution'
import { searchPatterns } from '@/lib/master-data/search'
import { formatScore } from '@/lib/forecast-quality'
import { TableScrollRegion } from './table-scroll-region'

export async function RedistributionSourcePicker({
  organizationId,
  draftId,
  locationId,
  itemId,
  cutoff,
  unit,
  locale,
  raw,
}: {
  organizationId: string
  draftId: string
  locationId: string
  itemId: string
  cutoff: string
  unit: string
  locale: string
  raw: RawSearchParams
}) {
  const [db, t, format] = await Promise.all([
    createClient(),
    getTranslations('Redistribution'),
    getFormatter(),
  ])
  const params = redistributionListParams(raw)
  const query = (head: boolean) => {
    let query = db
      .from('redistribution_source_options')
      .select('*', { count: 'exact', head })
      .eq('organization_id', organizationId)
      .eq('to_location_id', locationId)
      .eq('item_id', itemId)
      .eq('cutoff', cutoff)
      .eq('unit', unit)
    for (const pattern of searchPatterns(params.q)) query = query.like('search_text', pattern)
    return query
  }
  const count = await query(true)
  if (count.error) throw new Error('Sources unavailable')
  const total = count.count ?? 0
  const pages = lastPage(total, params.size)
  const href = (page: number) =>
    `/replenishment/redistribution/new?${new URLSearchParams({ draft: draftId, q: params.q, page: String(page), size: String(params.size) })}`
  if (params.page > pages) redirect(href(pages))
  const { from, to } = toRange(params.page, params.size)
  const range = nearestRange(from, to, total)
  const result = await query(false)
    .order('finished_at', { ascending: range.reversed })
    .order('id', { ascending: !range.reversed })
    .range(range.from, range.to)
  if (result.error?.code === 'PGRST103') redirect(href(1))
  if (result.error) throw new Error('Sources unavailable')
  const rows = range.reversed ? (result.data ?? []).toReversed() : (result.data ?? [])
  return (
    <section className="space-y-3" aria-label={t('chooseSource')}>
      <h2 className="text-section-title">{t('chooseSource')}</h2>
      <p className="text-muted-foreground">{t('sourceRules')}</p>
      <form
        method="get"
        action="/replenishment/redistribution/new"
        className="workspace-toolbar flex flex-wrap items-end gap-3"
      >
        <input type="hidden" name="draft" value={draftId} />
        <label className="grid min-w-0 gap-1">
          {t('sourceSearch')}
          <input
            name="q"
            maxLength={100}
            defaultValue={params.q}
            className="w-full min-w-0 rounded-md border bg-background p-2"
          />
        </label>
        <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
          {t('filter')}
        </button>
      </form>
      <p>{t('sourceCount', { count: total })}</p>
      <TableScrollRegion label={t('chooseSource')}>
        <table className="w-full min-w-[42rem] text-sm">
          <caption className="sr-only">{t('chooseSource')}</caption>
          <thead>
            <tr>
              {(['source', 'cutoff', 'maximum', 'laneLead', 'choose'] as const).map((key) => (
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
                  <Link className="underline" href={`/forecasts/workbench/${row.id}`}>
                    {row.source_code}
                  </Link>
                  <p className="text-xs font-normal text-muted-foreground">
                    {t('policySaved', {
                      time: row.finished_at
                        ? format.dateTime(new Date(row.finished_at), 'long')
                        : '—',
                    })}
                  </p>
                </th>
                <td className="p-2 whitespace-nowrap">{row.cutoff}</td>
                <td className="p-2 whitespace-nowrap tabular-nums">
                  {formatScore(row.maximum, locale)} {row.unit}
                </td>
                <td className="p-2 whitespace-nowrap">
                  {t('leadTimes', {
                    p50: row.lead_time_days_p50 ?? 0,
                    p90: row.lead_time_days_p90 ?? 0,
                  })}
                </td>
                <td className="p-2">
                  <Link
                    className="underline"
                    prefetch={false}
                    href={`/replenishment/redistribution/new?draft=${draftId}&policy=${row.id}`}
                  >
                    {t('chooseLocation', { location: row.source_code ?? '—' })}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
      {!rows.length && <p>{t('noSources')}</p>}
      <nav aria-label={t('sourcePages')} className="flex flex-wrap gap-4">
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
