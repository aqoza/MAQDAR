import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'

export default async function InstalledDemandHistory({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[]
    item?: string | string[]
    location?: string | string[]
    page?: string | string[]
  }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const search = await searchParams
  const scalar = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '')
  const q = scalar(search.q).trim().slice(0, 200),
    item = scalar(search.item).trim().slice(0, 100),
    location = scalar(search.location).trim().slice(0, 100)
  const [db, t, format] = await Promise.all([
    createClient(),
    getTranslations('InstalledBaseDemand'),
    getFormatter(),
  ])
  const base = () => {
    let query = db
      .from('installed_base_demand_scenarios')
      .select('id,scenario_name,item_code,location_code,cutoff,created_at', { count: 'exact' })
      .eq('organization_id', context.active!.id)
    if (q) query = query.ilike('scenario_name', `%${q.replace(/[\\%_]/g, '\\$&')}%`)
    if (item) query = query.eq('item_code', item)
    if (location) query = query.eq('location_code', location)
    return query
  }
  const count = await base().limit(0)
  if (count.error) throw new Error('Demand scenario history unavailable')
  const pages = Math.max(1, Math.ceil((count.count ?? 0) / 25))
  const current = Math.min(pages, Math.max(1, Number.parseInt(scalar(search.page), 10) || 1))
  const rows = await base()
    .order('created_at', { ascending: false })
    .order('id')
    .range((current - 1) * 25, current * 25 - 1)
  if (rows.error) throw new Error('Demand scenario history unavailable')
  const href = (page: number) =>
    `/forecasts/installed-base/demand?${new URLSearchParams({ q, item, location, page: String(page) })}`
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="forecasts"
        title={t('title')}
        description={t('description')}
        back={
          <Link href="/forecasts/installed-base" className="underline">
            {t('back')}
          </Link>
        }
        actions={
          <>
            <Link href="/forecasts/installed-base" className="underline">
              {t('choosePopulation')}
            </Link>
            <HelpDisclosure label={t('methodDetails')}>
              <p>{t('method')}</p>
              <p>{t('limits')}</p>
            </HelpDisclosure>
          </>
        }
      />
      <form
        className="grid gap-3 workspace-panel sm:grid-cols-2 lg:grid-cols-4"
        action="/forecasts/installed-base/demand"
      >
        {(
          [
            ['q', 'scenario_name', q],
            ['item', 'item_code', item],
            ['location', 'location_code', location],
          ] as const
        ).map(([name, label, value]) => (
          <label key={name} className="grid min-w-0 gap-1 text-sm">
            {t(label)}
            <input
              name={name}
              defaultValue={value}
              maxLength={200}
              className="min-w-0 w-full rounded-md border bg-background px-3 py-2"
            />
          </label>
        ))}
        <div className="flex flex-wrap items-end gap-3">
          <button className="min-h-11 rounded-md bg-primary px-4 text-sm text-primary-foreground">
            {t('search')}
          </button>
          <Link
            className="inline-flex min-h-11 items-center underline"
            href="/forecasts/installed-base/demand"
          >
            {t('reset')}
          </Link>
        </div>
      </form>
      {rows.data.length ? (
        <TableScrollRegion label={t('title')}>
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr>
                {(
                  ['scenario_name', 'item_code', 'location_code', 'cutoff', 'importTime'] as const
                ).map((key) => (
                  <th key={key} className="p-2 text-start">
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.data.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="max-w-80 break-words p-2">
                    <Link className="underline" href={`/forecasts/installed-base/demand/${row.id}`}>
                      {row.scenario_name}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap p-2">
                    <bdi>{row.item_code}</bdi>
                  </td>
                  <td className="whitespace-nowrap p-2">
                    <bdi>{row.location_code}</bdi>
                  </td>
                  <td className="whitespace-nowrap p-2">
                    <bdi>{row.cutoff}</bdi>
                  </td>
                  <td className="whitespace-nowrap p-2">
                    {format.dateTime(new Date(row.created_at), 'long')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollRegion>
      ) : (
        <p role="status" className="workspace-panel">
          {t('empty')}
        </p>
      )}
      {pages > 1 && (
        <nav aria-label={t('title')} className="flex flex-wrap items-center gap-4">
          <span>{t('page', { page: current, pages })}</span>
          {current > 1 && (
            <Link className="inline-flex min-h-11 items-center underline" href={href(current - 1)}>
              {t('previous')}
            </Link>
          )}
          {current < pages && (
            <Link className="inline-flex min-h-11 items-center underline" href={href(current + 1)}>
              {t('next')}
            </Link>
          )}
        </nav>
      )}
    </div>
  )
}
