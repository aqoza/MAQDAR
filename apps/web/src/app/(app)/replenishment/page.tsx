import type { Metadata } from 'next'
import Form from 'next/form'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { draftListParams, draftListSpec, replenishmentStatuses } from '@/lib/replenishment'
import {
  lastPage,
  listHref,
  nearestRange,
  toRange,
  type RawSearchParams,
} from '@/lib/master-data/list-params'
import { searchPatterns } from '@/lib/master-data/search'
import { formatScore } from '@/lib/forecast-quality'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Replenishment')
  return { title: t('title') }
}

export default async function ReplenishmentPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const params = draftListParams(await searchParams)
  const [db, t, locale] = await Promise.all([
    createClient(),
    getTranslations('Replenishment'),
    getLocale(),
  ])
  const query = (head: boolean) => {
    let q = db
      .from('replenishment_draft_list')
      .select('*', { count: 'exact', head })
      .eq('organization_id', context.active!.id)
    for (const pattern of searchPatterns(params.q)) q = q.like('search_text', pattern)
    if (params.filters.location) q = q.eq('location_code', params.filters.location)
    if (params.filters.status) q = q.eq('status', params.filters.status)
    return q
  }
  const count = await query(true)
  if (count.error) throw new Error('Drafts unavailable')
  const total = count.count ?? 0
  const pages = lastPage(total, params.size)
  const href = (page: number) => listHref('/replenishment', draftListSpec, params, { page })
  if (params.page > pages) redirect(href(pages))
  const { from, to } = toRange(params.page, params.size)
  const range = nearestRange(from, to, total)
  const ascending = params.dir === 'asc'
  const result = await query(false)
    .order('created_at', { ascending: range.reversed ? !ascending : ascending })
    .order('id', { ascending: !range.reversed })
    .range(range.from, range.to)
  if (result.error?.code === 'PGRST103') redirect(href(1))
  if (result.error) throw new Error('Drafts unavailable')
  const rows = range.reversed ? (result.data ?? []).toReversed() : (result.data ?? [])
  return (
    <div className="space-y-5">
      <Link href="/replenishment/review" className="block underline">
        {t('purchaseReview')}
      </Link>
      <Link href="/replenishment/handoffs" className="block underline">
        {t('purchaseHandoffs')}
      </Link>
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p>{t('description')}</p>
      <Link className="inline-block underline" href="/forecasts/workbench">
        {t('choosePolicy')}
      </Link>
      <Form
        action="/replenishment"
        className="flex flex-wrap items-end gap-3"
        key={JSON.stringify(params)}
      >
        <label className="grid gap-1">
          {t('search')}
          <input
            name="q"
            maxLength={100}
            defaultValue={params.q}
            className="rounded-md border bg-background p-2"
          />
        </label>
        <label className="grid gap-1">
          {t('location')}
          <input
            name="location"
            maxLength={64}
            defaultValue={params.filters.location ?? ''}
            className="rounded-md border bg-background p-2"
          />
        </label>
        <label className="grid gap-1">
          {t('result')}
          <select
            name="status"
            defaultValue={params.filters.status ?? ''}
            className="max-w-sm rounded-md border bg-background p-2"
          >
            <option value="">{t('all')}</option>
            {replenishmentStatuses.map((s) => (
              <option key={s} value={s}>
                {t(`statuses.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
          {t('filter')}
        </button>
        <Link className="underline" href="/replenishment">
          {t('reset')}
        </Link>
      </Form>
      <p>{t('count', { total })}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('title')}</caption>
          <thead>
            <tr>
              {(['item', 'location', 'cutoffLabel', 'result', 'gap', 'inspect'] as const).map(
                (k) => (
                  <th key={k} className="p-2 text-start">
                    {t(k)}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <th className="p-2 text-start">{row.item_code}</th>
                <td className="p-2">{row.location_code}</td>
                <td className="p-2">{row.cutoff}</td>
                <td className="p-2">
                  {t(`statuses.${z.enum(replenishmentStatuses).parse(row.status)}`)}
                </td>
                <td className="p-2 tabular-nums">
                  {formatScore(row.gap, locale)} {row.unit ?? '—'}
                </td>
                <td className="p-2">
                  <Link prefetch={false} className="underline" href={`/replenishment/${row.id}`}>
                    {t('inspectItem', { item: row.item_code ?? '—' })}
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
    </div>
  )
}
