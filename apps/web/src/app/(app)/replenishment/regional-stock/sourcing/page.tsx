import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'
import { regionalSourcingPath } from '@/lib/regional-sourcing'
import { firstParam, type RawSearchParams } from '@/lib/master-data/list-params'
import { searchPatterns } from '@/lib/master-data/search'
export default async function RegionalSourcingHistory({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const [db, t, locale, format, raw, dates] = await Promise.all([
    createClient(),
    getTranslations('RegionalSourcing'),
    getLocale(),
    getFormatter(),
    searchParams,
    getTranslations('RegionalDates'),
  ])
  const q = (firstParam(raw.q) ?? '').trim().slice(0, 100)
  const base = () => {
    let query = db
      .from('regional_sourcing_list')
      .select('*', { count: 'exact' })
      .eq('organization_id', context.active!.id)
    for (const pattern of searchPatterns(q)) query = query.like('search_text', pattern)
    return query
  }
  const count = await base().limit(0)
  if (count.error) throw new Error('Sourcing history unavailable')
  const pages = Math.max(1, Math.ceil((count.count ?? 0) / 25)),
    page = Math.min(pages, Math.max(1, Number.parseInt(firstParam(raw.page) ?? '1', 10) || 1))
  const rows = await base()
    .order('created_at', { ascending: false })
    .order('id')
    .range((page - 1) * 25, page * 25 - 1)
  if (rows.error) throw new Error('Sourcing history unavailable')
  const href = (p: number) =>
    `${regionalSourcingPath}?${new URLSearchParams({ q, page: String(p) })}`
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('title')}
        description={t('description')}
        back={
          <Link className="underline" href="/replenishment/regional-stock">
            {t('assessments')}
          </Link>
        }
        actions={
          <>
            <Link className="underline" href="/replenishment/regional-stock/sourcing/integrations">
              {(await getTranslations('IntegrationWorkbench'))('regionalLink')}
            </Link>

            {isEditorRole(context.role) && (
              <Link className="underline" href={`${regionalSourcingPath}/new`}>
                {t('new')}
              </Link>
            )}
            <Link className="underline" href={`${regionalSourcingPath}/dates`}>
              {dates('dateHistory')}
            </Link>
            <HelpDisclosure label={t('methodDetails')}>
              <p>{t('method')}</p>
              <p>{t('limits')}</p>
            </HelpDisclosure>
          </>
        }
      />
      <form
        action={regionalSourcingPath}
        className="flex flex-wrap items-end gap-3 workspace-panel"
      >
        <label className="grid min-w-0 grow gap-1 text-sm">
          {t('historySearch')}
          <input
            name="q"
            defaultValue={q}
            maxLength={100}
            className="min-w-0 rounded-md border bg-background p-2"
          />
        </label>
        <button className="min-h-11 rounded-md bg-primary px-4 text-primary-foreground">
          {t('search')}
        </button>
        <Link className="inline-flex min-h-11 items-center underline" href={regionalSourcingPath}>
          {t('reset')}
        </Link>
      </form>
      <p className="text-xs text-muted-foreground">{t('count', { count: count.count ?? 0 })}</p>
      {rows.data.length ? (
        <TableScrollRegion label={t('title')}>
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr>
                {(
                  [
                    'region',
                    'item',
                    'destination',
                    'cutoff',
                    'allocated',
                    'remainingGap',
                    'savedAt',
                  ] as const
                ).map((k) => (
                  <th className="p-3 text-start text-xs font-medium" key={k}>
                    {t(k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.data.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="max-w-72 break-words p-3">
                    <Link className="underline" href={`${regionalSourcingPath}/${row.id}`}>
                      {locale.startsWith('ar') && row.region_name_ar
                        ? row.region_name_ar
                        : row.region_name}
                    </Link>
                  </td>
                  <td className="p-3">
                    <bdi>{row.item_code}</bdi>
                  </td>
                  <td className="p-3">
                    <bdi>{row.destination_code}</bdi>
                  </td>
                  <td className="p-3 whitespace-nowrap">{row.cutoff}</td>
                  <td className="p-3 whitespace-nowrap">
                    <bdi>
                      {row.allocated} {row.unit}
                    </bdi>
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    <bdi>
                      {row.remaining_gap} {row.unit}
                    </bdi>
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    {format.dateTime(new Date(row.created_at!), 'long')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollRegion>
      ) : (
        <p role="status" className="workspace-panel">
          {t(q ? 'noMatches' : 'empty')}
        </p>
      )}
      {pages > 1 && (
        <nav className="flex flex-wrap items-center gap-3" aria-label={t('pages')}>
          <span>{t('page', { page, pages })}</span>
          {page > 1 && (
            <Link className="inline-flex min-h-11 items-center underline" href={href(page - 1)}>
              {t('previous')}
            </Link>
          )}
          {page < pages && (
            <Link className="inline-flex min-h-11 items-center underline" href={href(page + 1)}>
              {t('next')}
            </Link>
          )}
        </nav>
      )}
    </div>
  )
}
