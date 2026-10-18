import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { EventPolicyReport } from '@/components/event-policy-report'
import { eventPolicyReportSchema } from '@/lib/event-policies'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { isEditorRole } from '@/lib/auth/roles'

export default async function EventPolicyDetail({
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
    getTranslations('EventPolicies'),
    getFormatter(),
  ])
  const { data, error } = await db
    .from('event_policy_scenarios')
    .select('created_at,report')
    .eq('organization_id', context.active.id)
    .eq('id', scenarioId)
    .maybeSingle()
  if (error) throw new Error('Event policy scenario unavailable')
  if (!data) notFound()
  const report = eventPolicyReportSchema.parse(data.report)
  const draftT = await getTranslations('EventReplenishment')
  return (
    <div className="space-y-4">
      <PageHeader
        pattern="forecasts"
        title={t('saved')}
        description={<span className="break-words">{report.event.input.name}</span>}
        actions={
          <Link
            className="underline"
            href={`/forecasts/events/policies?event=${report.input.event_id}`}
          >
            {t('history')}
          </Link>
        }
      />
      <div className="space-y-2 workspace-panel">
        <p className="break-words">
          <bdi>
            {report.event.source.item_code} · {report.event.source.location_code} ·{' '}
            {report.event.input.unit}
          </bdi>
        </p>
        <p className="whitespace-pre-wrap break-words">{report.input.reason}</p>
        <p className="text-xs text-muted-foreground">
          {t('savedAt', { time: format.dateTime(new Date(data.created_at), 'long') })}
        </p>
      </div>
      <EventPolicyReport report={report} />
      <div className="flex flex-wrap gap-4">
        {isEditorRole(context.role) && (
          <Link className="underline" href={`/replenishment/events/new?scenario=${scenarioId}`}>
            {draftT('new')}
          </Link>
        )}
        <Link className="underline" href={`/replenishment/events?scenario=${scenarioId}`}>
          {draftT('history')}
        </Link>
      </div>
    </div>
  )
}
