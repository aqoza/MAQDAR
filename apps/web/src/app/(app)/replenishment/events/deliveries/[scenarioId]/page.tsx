import Link from 'next/link'
import { isEditorRole } from '@/lib/auth/roles'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { EventDeliveryReport } from '@/components/event-delivery-report'
import { eventDeliveryReportSchema } from '@/lib/event-deliveries'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'

export default async function EventDeliveryDetail({
  params,
}: {
  params: Promise<{ scenarioId: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { scenarioId } = await params
  if (!z.guid().safeParse(scenarioId).success) notFound()
  const [db, t, format] = await Promise.all([
    createClient(),
    getTranslations('EventDeliveries'),
    getFormatter(),
  ])
  const { data, error } = await db
    .from('event_delivery_scenarios')
    .select('created_at,report')
    .eq('organization_id', context.active.id)
    .eq('id', scenarioId)
    .maybeSingle()
  if (error) throw new Error('Event replenishment draft unavailable')
  if (!data) notFound()
  const report = eventDeliveryReportSchema.parse(data.report)
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('saved')}
        description={
          <span className="break-words">{report.source.draft.scenario.event.input.name}</span>
        }
        actions={
          <Link
            className="underline"
            href={`/replenishment/events/deliveries?scenario=${report.input.scenario_id}`}
          >
            {t('history')}
          </Link>
        }
      />
      <p className="text-sm">
        <bdi>
          {report.source.draft.scenario.event.source.item_code} ·{' '}
          {report.source.draft.scenario.event.source.location_code} ·{' '}
          {report.source.draft.scenario.event.input.unit}
        </bdi>{' '}
        · {t('cutoff', { date: report.source.draft.scenario.event.source.cutoff })}
      </p>
      <div className="flex flex-wrap gap-4">
        {isEditorRole(context.role) && (
          <Link
            className="underline"
            href={`/replenishment/events/costs/new?delivery=${scenarioId}`}
          >
            {(await getTranslations('EventCosts'))('new')}
          </Link>
        )}
        <Link className="underline" href={`/replenishment/events/costs?delivery=${scenarioId}`}>
          {(await getTranslations('EventCosts'))('history')}
        </Link>
      </div>
      <EventDeliveryReport report={report} />
      <p className="text-xs text-muted-foreground">
        {t('savedAt', { time: format.dateTime(new Date(data.created_at), 'long') })}
      </p>
    </div>
  )
}
