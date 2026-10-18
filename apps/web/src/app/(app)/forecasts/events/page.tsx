import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { eventTypes } from '@/lib/planned-events'
import { isEditorRole } from '@/lib/auth/roles'

export default async function EventHistory({
  searchParams,
}: {
  searchParams: Promise<{ forecast?: string; page?: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { forecast, page } = await searchParams
  if (!z.guid().safeParse(forecast).success) notFound()
  const [db, t, format] = await Promise.all([
    createClient(),
    getTranslations('PlannedEvents'),
    getFormatter(),
  ])
  const source = await db
    .from('forecast_results')
    .select('item_code,run_id,item_id')
    .eq('organization_id', context.active.id)
    .eq('id', forecast!)
    .maybeSingle()
  if (source.error) throw new Error('Event source unavailable')
  if (!source.data) notFound()
  const count = await db
    .from('planned_event_scenarios')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', context.active.id)
    .eq('forecast_id', forecast!)
  if (count.error) throw new Error('Event history unavailable')
  const pages = Math.max(1, Math.ceil((count.count ?? 0) / 25))
  const current = Math.min(pages, Math.max(1, Number.parseInt(page ?? '1', 10) || 1))
  const rows = await db
    .from('planned_event_scenarios')
    .select('id,name,event_type,created_at')
    .eq('organization_id', context.active.id)
    .eq('forecast_id', forecast!)
    .order('created_at', { ascending: false })
    .order('id')
    .range((current - 1) * 25, current * 25 - 1)
  if (rows.error) throw new Error('Event history unavailable')
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('history')}
        description={<span className="break-words">{source.data.item_code}</span>}
        actions={
          <>
            <Link
              className="underline"
              href={`/forecasts/results/${source.data.run_id}?item=${source.data.item_id}`}
            >
              {t('source')}
            </Link>
            {isEditorRole(context.role) && (
              <Link className="underline" href={`/forecasts/events/new?forecast=${forecast}`}>
                {t('new')}
              </Link>
            )}
          </>
        }
      />
      <p className="text-sm text-muted-foreground">{t('independent')}</p>
      <ul className="divide-y workspace-panel">
        {rows.data.map((row) => (
          <li key={row.id} className="flex flex-wrap justify-between gap-2 py-3">
            <Link className="min-w-0 break-words underline" href={`/forecasts/events/${row.id}`}>
              {row.name}
            </Link>
            <span>
              {t(`types.${z.enum(eventTypes).parse(row.event_type)}`)} ·{' '}
              {format.dateTime(new Date(row.created_at), 'long')}
            </span>
          </li>
        ))}
      </ul>
      {!rows.data.length && <p>{t('empty')}</p>}
      {pages > 1 && (
        <nav className="flex flex-wrap gap-4" aria-label={t('history')}>
          <span>{t('historyPage', { page: current, pages })}</span>
          {current > 1 && (
            <Link
              className="underline"
              href={`/forecasts/events?forecast=${forecast}&page=${current - 1}`}
            >
              {t('previous')}
            </Link>
          )}
          {current < pages && (
            <Link
              className="underline"
              href={`/forecasts/events?forecast=${forecast}&page=${current + 1}`}
            >
              {t('next')}
            </Link>
          )}
        </nav>
      )}
    </div>
  )
}
