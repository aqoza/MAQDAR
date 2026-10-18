import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { EventReplenishmentReport } from '@/components/event-replenishment-report'
import { eventDraftReportSchema } from '@/lib/event-replenishment'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'

export default async function EventDraftDetail({
  params,
}: {
  params: Promise<{ draftId: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { draftId } = await params
  if (!z.uuid().safeParse(draftId).success) notFound()
  const [db, t, format] = await Promise.all([
    createClient(),
    getTranslations('EventReplenishment'),
    getFormatter(),
  ])
  const { data, error } = await db
    .from('event_replenishment_drafts')
    .select('created_at,report')
    .eq('organization_id', context.active.id)
    .eq('id', draftId)
    .maybeSingle()
  if (error) throw new Error('Event replenishment draft unavailable')
  if (!data) notFound()
  const report = eventDraftReportSchema.parse(data.report)
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('saved')}
        description={<span className="break-words">{report.scenario.event.input.name}</span>}
        actions={
          <Link
            className="underline"
            href={`/replenishment/events?scenario=${report.input.scenario_id}`}
          >
            {t('history')}
          </Link>
        }
      />
      <p className="text-sm">
        <bdi>
          {report.scenario.event.source.item_code} · {report.scenario.event.source.location_code} ·{' '}
          {report.scenario.event.input.unit}
        </bdi>{' '}
        · {t('cutoff', { date: report.scenario.event.source.cutoff })}
      </p>
      <EventReplenishmentReport report={report} />
      <p className="text-xs text-muted-foreground">
        {t('savedAt', { time: format.dateTime(new Date(data.created_at), 'long') })}
      </p>
    </div>
  )
}
