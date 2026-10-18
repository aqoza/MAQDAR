import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { PlannedEventReport } from '@/components/planned-event-report'
import { eventReportSchema } from '@/lib/planned-events'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'

export default async function EventDetail({ params }: { params: Promise<{ scenarioId: string }> }) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { scenarioId } = await params
  if (!z.guid().safeParse(scenarioId).success) notFound()
  const [db, t, format] = await Promise.all([
    createClient(),
    getTranslations('PlannedEvents'),
    getFormatter(),
  ])
  const { data, error } = await db
    .from('planned_event_scenarios')
    .select('created_at,report')
    .eq('organization_id', context.active.id)
    .eq('id', scenarioId)
    .maybeSingle()
  if (error) throw new Error('Event scenario unavailable')
  if (!data) notFound()
  const report = eventReportSchema.parse(data.report)
  return (
    <div className="space-y-4">
      <PageHeader
        title={<span className="break-words">{report.input.name}</span>}
        description={t('savedDescription')}
        actions={
          <Link
            className="underline"
            href={`/forecasts/events?forecast=${report.source.forecast_id}`}
          >
            {t('history')}
          </Link>
        }
      />
      <div className="space-y-2 workspace-panel">
        <p className="break-words">
          <bdi>
            {report.source.item_code} · {report.source.location_code} · {report.input.unit}
          </bdi>{' '}
          · {t(`types.${report.input.event_type}`)}
        </p>
        <p className="whitespace-pre-wrap break-words">{report.input.reason}</p>
        <p className="text-xs text-muted-foreground">
          {t('savedAt', { time: format.dateTime(new Date(data.created_at), 'long') })}
        </p>
        <Link
          className="underline"
          href={`/forecasts/results/${report.source.run_id}?item=${report.source.item_id}`}
        >
          {t('source')}
        </Link>
      </div>
      <PlannedEventReport report={report} />
    </div>
  )
}
