import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { isEditorRole } from '@/lib/auth/roles'

export default async function EventPolicyHistory({
  searchParams,
}: {
  searchParams: Promise<{ event?: string; page?: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { event, page } = await searchParams
  if (!z.guid().safeParse(event).success) notFound()
  const [db, t, format] = await Promise.all([
    createClient(),
    getTranslations('EventPolicies'),
    getFormatter(),
  ])
  const source = await db
    .from('planned_event_scenarios')
    .select('name')
    .eq('organization_id', context.active.id)
    .eq('id', event!)
    .maybeSingle()
  if (source.error) throw new Error('Event source unavailable')
  if (!source.data) notFound()
  const count = await db
    .from('event_policy_scenarios')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', context.active.id)
    .eq('event_id', event!)
  if (count.error) throw new Error('Event policy history unavailable')
  const pages = Math.max(1, Math.ceil((count.count ?? 0) / 25))
  const current = Math.min(pages, Math.max(1, Number.parseInt(page ?? '1', 10) || 1))
  const rows = await db
    .from('event_policy_scenarios')
    .select('id,created_at,reason:report->input->>reason')
    .eq('organization_id', context.active.id)
    .eq('event_id', event!)
    .order('created_at', { ascending: false })
    .order('id')
    .range((current - 1) * 25, current * 25 - 1)
  if (rows.error) throw new Error('Event policy history unavailable')
  return (
    <div className="space-y-4">
      <PageHeader
        pattern="forecasts"
        title={t('history')}
        description={<span className="break-words">{source.data.name}</span>}
        actions={
          <>
            <Link className="underline" href={`/forecasts/events/${event}`}>
              {t('eventSource')}
            </Link>
            {isEditorRole(context.role) && (
              <Link className="underline" href={`/forecasts/events/policies/new?event=${event}`}>
                {t('new')}
              </Link>
            )}
          </>
        }
      />
      <p className="text-sm text-muted-foreground">{t('historyNote')}</p>
      {rows.data.length ? (
        <ul className="space-y-3">
          {rows.data.map((row) => (
            <li key={row.id} className="space-y-2 workspace-panel">
              <Link className="break-words underline" href={`/forecasts/events/policies/${row.id}`}>
                {row.reason}
              </Link>
              <p className="text-xs text-muted-foreground">
                {t('savedAt', { time: format.dateTime(new Date(row.created_at), 'long') })}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p>{t('empty')}</p>
      )}
      <nav aria-label={t('pagination')} className="flex flex-wrap gap-4">
        {current > 1 && (
          <Link
            className="underline"
            href={`/forecasts/events/policies?event=${event}&page=${current - 1}`}
          >
            {t('previous')}
          </Link>
        )}
        <span>{t('page', { page: current, pages })}</span>
        {current < pages && (
          <Link
            className="underline"
            href={`/forecasts/events/policies?event=${event}&page=${current + 1}`}
          >
            {t('next')}
          </Link>
        )}
      </nav>
    </div>
  )
}
