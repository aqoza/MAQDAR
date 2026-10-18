import Link from 'next/link'
import Form from 'next/form'
import { redirect } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { ExcessStockHeader } from '@/components/excess-stock-header'
import { ExcessStockFilters, ExcessStockPagination } from '@/components/excess-stock-list-controls'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import {
  excessCandidateSchema,
  excessCandidateSpec,
  excessChoices,
  excessCutoff,
  excessHref,
  excessListParams,
  excessTokens,
} from '@/lib/excess-stock'
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
  return { title: (await getTranslations('ExcessStock'))('new') }
}
export default async function NewAssessment({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  if (!['owner', 'admin', 'planner'].includes(context.active.role))
    redirect('/replenishment/excess')
  const [raw, db, t, locale, format] = await Promise.all([
    searchParams,
    createClient(),
    getTranslations('ExcessStock'),
    getLocale(),
    getFormatter(),
  ])
  const tokens = excessTokens(raw)
  const parsed = tokens.length ? excessChoices(tokens) : null
  if (parsed && !parsed.success)
    return (
      <div className="space-y-4">
        <ExcessStockHeader />
        <p role="alert">{t('invalid')}</p>
        <Link className="underline" href="/replenishment/excess/new">
          {t('clear')}
        </Link>
      </div>
    )
  const selectedResult = tokens.length
    ? await db
        .from('excess_stock_candidates')
        .select('*')
        .eq('organization_id', context.active.id)
        .in('id', tokens)
    : { data: [], error: null }
  if (selectedResult.error) throw new Error('Assessment candidates unavailable')
  const selected = z.array(excessCandidateSchema).parse(selectedResult.data)
  const params = excessListParams(raw, true)
  const cutoff = excessCutoff(raw)
  const first = selected[0]
  const query = (head: boolean) => {
    let q = db
      .from('excess_stock_candidates')
      .select('*', { count: 'exact', head })
      .eq('organization_id', context.active!.id)
    for (const pattern of searchPatterns(params.q)) q = q.like('search_text', pattern)
    if (params.filters.location) q = q.eq('location_code', params.filters.location)
    if (cutoff) q = q.eq('cutoff', cutoff)
    if (first)
      q = q
        .eq('location_id', first.location_id)
        .eq('cutoff', first.cutoff)
        .not('item_id', 'in', `(${selected.map((s) => s.item_id).join(',')})`)
    return q
  }
  const count = await query(true)
  if (count.error) throw new Error('Assessment candidates unavailable')
  const total = count.count ?? 0
  const pages = lastPage(total, params.size)
  const href = (page: number, choices = tokens) => {
    const url = new URL(
      listHref('/replenishment/excess/new', excessCandidateSpec, params, { page }),
      'https://local.invalid',
    )
    if (cutoff) url.searchParams.set('cutoff', cutoff)
    choices.forEach((choice) => url.searchParams.append('choice', choice))
    return `${url.pathname}${url.search}`
  }
  if (params.page > pages) redirect(href(pages))
  const { from, to } = toRange(params.page, params.size)
  const range = nearestRange(from, to, total)
  const result = await query(false)
    .order('finished_at', {
      ascending: range.reversed ? params.dir !== 'asc' : params.dir === 'asc',
    })
    .order('id', { ascending: !range.reversed })
    .range(range.from, range.to)
  if (result.error?.code === 'PGRST103') redirect(href(1))
  if (result.error) throw new Error('Assessment candidates unavailable')
  const rows = z
    .array(excessCandidateSchema)
    .parse(range.reversed ? result.data.toReversed() : result.data)
  const date = (v: string) => format.dateTime(new Date(v), { dateStyle: 'medium', timeZone: 'UTC' })
  return (
    <div className="min-w-0 space-y-4">
      <ExcessStockHeader />
      <section className="workspace-panel space-y-3">
        <h2 className="text-section-title">{t('selection', { count: tokens.length })}</h2>
        <p>{t('selectionHint')}</p>
        <ul className="grid gap-2 lg:grid-cols-2">
          {tokens.map((token) => {
            const row = selected.find((r) => r.id === token)
            return (
              <li
                key={token}
                className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border p-2"
              >
                <span className="min-w-0 break-words">
                  {row
                    ? `${row.item_code} · ${row.location_code} · ${date(row.cutoff)} · ${row.maximum === 'calculated' ? t('calculated') : t('approved', { revision: row.revision ?? 0 })}`
                    : t('missingSelection')}
                </span>
                <Link
                  className="underline"
                  href={href(
                    1,
                    tokens.filter((x) => x !== token),
                  )}
                >
                  {t('remove', { item: row?.item_code ?? t('missingSelection') })}
                </Link>
              </li>
            )
          })}
        </ul>
        <div className="flex flex-wrap gap-4">
          <Link className="underline" href="/replenishment/excess/new">
            {t('clear')}
          </Link>
          {tokens.length > 0 && selected.length === tokens.length && (
            <Link
              className="rounded-md bg-primary px-3 py-2 text-primary-foreground"
              href={excessHref(tokens, '/replenishment/excess/preview')}
            >
              {t('preview')}
            </Link>
          )}
        </div>
      </section>
      <ExcessStockFilters params={params} cutoff={cutoff} tokens={tokens} candidates />
      <Form
        action="/replenishment/excess/new"
        key={JSON.stringify([tokens, params])}
        className="space-y-3"
      >
        {tokens.map((token) => (
          <input key={token} type="hidden" name="choice" value={token} />
        ))}
        <input type="hidden" name="q" value={params.q} />
        <input type="hidden" name="location" value={params.filters.location ?? ''} />
        <input type="hidden" name="cutoff" value={cutoff ?? ''} />
        <input type="hidden" name="size" value={params.size} />
        <input type="hidden" name="dir" value={params.dir} />
        <TableScrollRegion label={t('candidates')}>
          <table className="w-full min-w-[56rem] text-sm">
            <thead>
              <tr>
                {(['item', 'location', 'cutoff', 'policy', 'maximum', 'select'] as const).map(
                  (key) => (
                    <th key={key} className="p-3 text-start text-xs font-medium">
                      {t(key)}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t align-top">
                  <th className="p-3 text-start font-medium">{row.item_code}</th>
                  <td className="p-3">{row.location_code}</td>
                  <td className="whitespace-nowrap p-3">{date(row.cutoff)}</td>
                  <td className="whitespace-nowrap p-3">
                    <Link className="underline" href={`/forecasts/workbench/${row.policy_id}`}>
                      {format.dateTime(new Date(row.finished_at), 'long')}
                    </Link>
                    <p className="text-xs">{row.policy_id}</p>
                  </td>
                  <td className="p-3">
                    <p className="whitespace-nowrap">
                      {formatCostDecimal(row.quantity, locale, 100)} {row.unit ?? '—'}
                    </p>
                    <p>
                      {row.maximum === 'calculated'
                        ? t('calculated')
                        : t('approved', { revision: row.revision ?? 0 })}
                    </p>
                  </td>
                  <td className="p-3">
                    {tokens.length < 50 && (
                      <label className="inline-flex min-h-11 min-w-11 items-center justify-center">
                        <input
                          type="radio"
                          name={`pick.${row.item_id}`}
                          value={row.id}
                          aria-label={t('selectItem', { item: row.item_code })}
                        />
                      </label>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollRegion>
        <button
          disabled={!rows.length || tokens.length >= 50}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
        >
          {t('addSelected')}
        </button>
      </Form>
      {!rows.length && <p>{t('emptyCandidates')}</p>}
      <ExcessStockPagination
        page={params.page}
        pages={pages}
        previous={params.page > 1 ? href(params.page - 1) : undefined}
        next={params.page < pages ? href(params.page + 1) : undefined}
      />
    </div>
  )
}
