import Link from 'next/link'
import { HandoffAcknowledgements } from '@/components/handoff-acknowledgements'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { EventHandoffBatchesHelp } from '@/components/event-handoff-batches-help'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { batchPayloadSchema } from '@/lib/event-handoff-batches'
import { EventHandoffBatchEvidence } from '@/components/event-handoff-batch-evidence'
import { EventHandoffBatchOverlap } from '@/components/event-handoff-batch-overlap'

export default async function BatchDetail({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>
  searchParams: Promise<{ ack_page?: string | string[] }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { batchId } = await params
  if (!z.guid().safeParse(batchId).success) notFound()
  const [db, t, format] = await Promise.all([
    createClient(),
    getTranslations('EventHandoffBatches'),
    getFormatter(),
  ])
  const [saved, current] = await Promise.all([
    db
      .from('event_purchase_handoff_batches')
      .select('payload,handoff_ids')
      .eq('organization_id', context.active.id)
      .eq('id', batchId)
      .maybeSingle(),
    db
      .from('event_purchase_handoff_batch_list')
      .select('selected')
      .eq('organization_id', context.active.id)
      .eq('id', batchId)
      .maybeSingle(),
  ])
  if (saved.error || current.error) throw new Error('Event batch unavailable')
  if (!saved.data || !current.data) notFound()
  const payload = batchPayloadSchema.parse(saved.data.payload)
  return (
    <div className="space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('detailTitle', { supplier: payload.summary.supplier_code })}
        description={t('context')}
        back={
          <Link className="underline" href="/replenishment/events/batches">
            {t('back')}
          </Link>
        }
        help={<EventHandoffBatchesHelp />}
      />
      <p className="break-all">{t('batchIdentity', { id: batchId })}</p>
      <p>{t('savedAt', { time: format.dateTime(new Date(payload.created_at), 'long') })}</p>
      <section className="space-y-2 workspace-panel" aria-label={t('currentContext')}>
        <h2 className="text-section-title">{t('currentContext')}</h2>
        <p role="status">{t(current.data.selected ? 'current' : 'historical')}</p>
        <p>{t('immutableNote')}</p>
      </section>
      <div className="flex flex-wrap gap-4">
        <a download className="underline" href={`/api/event-handoff-batches/${batchId}/json`}>
          {t('json')}
        </a>
        <a download className="underline" href={`/api/event-handoff-batches/${batchId}/csv`}>
          {t('csv')}
        </a>
      </div>
      <HandoffAcknowledgements
        organizationId={context.active.id}
        recordId={batchId}
        kind="event"
        batch
        pageValue={(await searchParams).ack_page}
      />
      <EventHandoffBatchEvidence report={payload} />
      <EventHandoffBatchOverlap
        organizationId={context.active.id}
        handoffIds={saved.data.handoff_ids}
        excludeId={batchId}
      />
    </div>
  )
}
