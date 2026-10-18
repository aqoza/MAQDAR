import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { isEditorRole } from '@/lib/auth/roles'
import { PageHeader } from '@/components/page-header'
import { EventSupplierReport } from '@/components/event-supplier-report'
import { eventSupplierReportSchema } from '@/lib/event-suppliers'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'

export default async function EventSupplierDetail({
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
    getTranslations('EventSuppliers'),
    getFormatter(),
  ])
  const { data, error } = await db
    .from('event_supplier_scenarios')
    .select('created_at,report')
    .eq('organization_id', context.active.id)
    .eq('id', scenarioId)
    .maybeSingle()
  if (error) throw new Error('Event replenishment draft unavailable')
  if (!data) notFound()
  const report = eventSupplierReportSchema.parse(data.report)
  return (
    <div className="space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('saved')}
        description={<span className="break-words">{report.draft.scenario.event.input.name}</span>}
        actions={
          <Link
            className="underline"
            href={`/replenishment/events/suppliers?draft=${report.input.draft_id}`}
          >
            {t('history')}
          </Link>
        }
      />
      <p className="text-sm">
        <bdi>
          {report.draft.scenario.event.source.item_code} ·{' '}
          {report.draft.scenario.event.source.location_code} ·{' '}
          {report.draft.scenario.event.input.unit}
        </bdi>{' '}
        · {t('cutoff', { date: report.draft.scenario.event.source.cutoff })}
      </p>
      <div className="flex flex-wrap gap-4">
        {isEditorRole(context.role) && (
          <Link
            className="underline"
            href={`/replenishment/events/deliveries/new?scenario=${scenarioId}`}
          >
            {(await getTranslations('EventDeliveries'))('new')}
          </Link>
        )}
        <Link
          className="underline"
          href={`/replenishment/events/deliveries?scenario=${scenarioId}`}
        >
          {(await getTranslations('EventDeliveries'))('history')}
        </Link>
      </div>
      <EventSupplierReport report={report} />
      <p className="text-xs text-muted-foreground">
        {t('savedAt', { time: format.dateTime(new Date(data.created_at), 'long') })}
      </p>
    </div>
  )
}
