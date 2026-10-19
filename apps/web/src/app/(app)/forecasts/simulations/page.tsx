import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { firstParam, type RawSearchParams } from '@/lib/master-data/list-params'

export default async function Simulations({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const raw = firstParam((await searchParams).page) ?? '1'
  const page = /^\d{1,6}$/.test(raw) ? Math.max(1, Math.min(Number(raw), 100000)) : 1
  const [db, t, planning] = await Promise.all([
    createClient(),
    getTranslations('PolicySimulation'),
    getTranslations('Planning'),
  ])
  const result = await db
    .from('planning_runs')
    .select('id,status,from_date,to_date,created_at,locations(code)', { count: 'exact' })
    .eq('organization_id', context.active.id)
    .eq('kind', 'simulation')
    .order('created_at', { ascending: false })
    .order('id')
    .range((page - 1) * 25, page * 25 - 1)
  const pages = Math.max(1, Math.ceil((result.count ?? 0) / 25))
  if (result.error?.code === 'PGRST103' || page > pages) redirect('/forecasts/simulations')
  if (result.error) throw new Error('Simulation history unavailable')
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="forecasts"
        title={t('title')}
        description={t('description')}
        back={
          <Link href="/forecasts" className="underline">
            {t('forecasts')}
          </Link>
        }
        actions={
          <Link href="/forecasts/workbench" className="underline">
            {t('choosePolicy')}
          </Link>
        }
      />
      {!result.data?.length ? (
        <p>{t('empty')}</p>
      ) : (
        <TableScrollRegion label={t('history')}>
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr>
                {(['location', 'window', 'status', 'inspect'] as const).map((key) => (
                  <th className="p-3 text-start" key={key}>
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.data.map((run) => (
                <tr key={run.id} className="border-t">
                  <th className="p-3 text-start font-medium">{run.locations?.code}</th>
                  <td className="p-3">
                    {run.from_date} – {run.to_date}
                  </td>
                  <td className="p-3">
                    {planning(
                      `status.${run.status as 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'}`,
                    )}
                  </td>
                  <td className="p-3">
                    <Link
                      className="inline-flex min-h-11 items-center underline"
                      href={`/forecasts/simulations/${run.id}`}
                    >
                      {t('inspect')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollRegion>
      )}
      <nav aria-label={t('pagination')} className="flex flex-wrap items-center gap-4">
        {page > 1 && (
          <Link className="inline-flex min-h-11 items-center underline" href={`?page=${page - 1}`}>
            {t('previous')}
          </Link>
        )}
        <span>{t('page', { page, pages })}</span>
        {page < pages && (
          <Link className="inline-flex min-h-11 items-center underline" href={`?page=${page + 1}`}>
            {t('next')}
          </Link>
        )}
      </nav>
    </div>
  )
}
