import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'

export default async function StockRegionHistory({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[]
    status?: string | string[]
    location?: string | string[]
    page?: string | string[]
  }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const search = await searchParams
  const scalar = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '')
  const q = scalar(search.q).trim().slice(0, 200),
    status = ['active', 'archived'].includes(scalar(search.status)) ? scalar(search.status) : '',
    location = scalar(search.location).trim().slice(0, 100)
  const [db, t, format, locale] = await Promise.all([
    createClient(),
    getTranslations('StockRegion'),
    getFormatter(),
    getLocale(),
  ])
  const base = () => {
    let query = db
      .from('stock_regions')
      .select('id,name_en,name_ar,location_codes,archived_at,created_at', { count: 'exact' })
      .eq('organization_id', context.active!.id)
    if (q) query = query.ilike('name_en', `%${q.replace(/[\\%_]/g, '\\$&')}%`)
    if (status === 'active') query = query.is('archived_at', null)
    if (status === 'archived') query = query.not('archived_at', 'is', null)
    if (location) query = query.contains('location_codes', [location])
    return query
  }
  const count = await base().limit(0)
  if (count.error) throw new Error('Regional stock history unavailable')
  const pages = Math.max(1, Math.ceil((count.count ?? 0) / 25))
  const current = Math.min(pages, Math.max(1, Number.parseInt(scalar(search.page), 10) || 1))
  const rows = await base()
    .order('created_at', { ascending: false })
    .order('id')
    .range((current - 1) * 25, current * 25 - 1)
  if (rows.error) throw new Error('Regional stock history unavailable')
  const href = (page: number) =>
    `/replenishment/regional-stock/regions?${new URLSearchParams({ q, status, location, page: String(page) })}`
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('title')}
        description={t('description')}
        back={
          <Link href="/replenishment/regional-stock" className="underline">
            {t('assessments')}
          </Link>
        }
        actions={
          <>
            {isEditorRole(context.role) && (
              <Link href="/replenishment/regional-stock/regions/new" className="underline">
                {t('new')}
              </Link>
            )}
            <HelpDisclosure label={t('methodDetails')}>
              <p>{t('method')}</p>
              <p>{t('limits')}</p>
            </HelpDisclosure>
          </>
        }
      />
      <form
        className="grid gap-3 workspace-panel sm:grid-cols-2 lg:grid-cols-4"
        action="/replenishment/regional-stock/regions"
      >
        {(
          [
            ['q', 'name_en', q],
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
        <label className="grid min-w-0 gap-1 text-sm">
          {t('status')}
          <select
            name="status"
            defaultValue={status}
            className="min-w-0 w-full rounded-md border bg-background px-3 py-2"
          >
            <option value="">{t('all')}</option>
            <option value="active">{t('active')}</option>
            <option value="archived">{t('archived')}</option>
          </select>
        </label>
        <div className="flex flex-wrap items-end gap-3">
          <button className="min-h-11 rounded-md bg-primary px-4 text-sm text-primary-foreground">
            {t('search')}
          </button>
          <Link
            className="inline-flex min-h-11 items-center underline"
            href="/replenishment/regional-stock/regions"
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
                {(['region', 'location_code', 'status', 'importTime'] as const).map((key) => (
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
                    <Link
                      className="underline"
                      href={`/replenishment/regional-stock/regions/${row.id}`}
                    >
                      {locale.startsWith('ar') && row.name_ar ? row.name_ar : row.name_en}
                    </Link>
                  </td>
                  <td className="max-w-80 break-words p-2">
                    <bdi>{row.location_codes.join(' · ')}</bdi>
                  </td>
                  <td className="whitespace-nowrap p-2">
                    {t(row.archived_at ? 'archived' : 'active')}
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
