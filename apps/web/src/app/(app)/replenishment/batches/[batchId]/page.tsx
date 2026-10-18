import { HelpDisclosure } from '@/components/help-disclosure'
import { ContainerCapacityHistory } from '@/components/container-capacity-history'
import { HandoffAcknowledgements } from '@/components/handoff-acknowledgements'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { batchPayloadSchema } from '@/lib/handoff-batches'
import { HandoffBatchEvidence } from '@/components/handoff-batch-evidence'
import { HandoffBatchOverlap } from '@/components/handoff-batch-overlap'

export default async function BatchDetail({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>
  searchParams: Promise<{ ack_page?: string | string[]; capacity_page?: string | string[] }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { batchId } = await params
  if (!z.guid().safeParse(batchId).success) notFound()
  const [db, t, format] = await Promise.all([
    createClient(),
    getTranslations('HandoffBatches'),
    getFormatter(),
  ])
  const [saved, current] = await Promise.all([
    db
      .from('purchase_handoff_batches')
      .select('payload,handoff_ids')
      .eq('organization_id', context.active.id)
      .eq('id', batchId)
      .maybeSingle(),
    db
      .from('purchase_handoff_batch_list')
      .select('selected')
      .eq('organization_id', context.active.id)
      .eq('id', batchId)
      .maybeSingle(),
  ])
  if (saved.error || current.error) throw new Error('Batch unavailable')
  if (!saved.data || !current.data) notFound()
  const payload = batchPayloadSchema.parse(saved.data.payload)
  return (
    <div className="space-y-4">
      <Link className="underline" href="/replenishment/batches">
        {t('back')}
      </Link>
      <h1 className="text-page-title">
        {t('detailTitle', { supplier: payload.summary.supplier_code })}
      </h1>
      <p>{t('description')}</p>
      <p className="break-all">{t('batchIdentity', { id: batchId })}</p>
      <p>{t('savedAt', { time: format.dateTime(new Date(payload.created_at), 'long') })}</p>
      <section className="space-y-2 workspace-panel" aria-label={t('currentContext')}>
        <h2 className="text-section-title">{t('currentContext')}</h2>
        <p role="status">{t(current.data.selected ? 'current' : 'historical')}</p>
        <p>{t('immutableNote')}</p>
      </section>
      <div className="flex flex-wrap gap-4">
        <Link className="underline" href={`/replenishment/capacity/new?batch=${batchId}`}>
          {t('capacity')}
        </Link>
        <a className="underline" href={`/api/handoff-batches/${batchId}/json`}>
          {t('json')}
        </a>
        <a className="underline" href={`/api/handoff-batches/${batchId}/csv`}>
          {t('csv')}
        </a>
      </div>
      <HelpDisclosure>
        <p>{t('csvNote')}</p>
      </HelpDisclosure>
      <HandoffBatchEvidence report={payload} />
      <ContainerCapacityHistory
        organizationId={context.active.id}
        batchId={batchId}
        pageValue={(await searchParams).capacity_page}
      />
      <HandoffAcknowledgements
        organizationId={context.active.id}
        recordId={batchId}
        batch
        pageValue={(await searchParams).ack_page}
      />
      <HandoffBatchOverlap
        organizationId={context.active.id}
        handoffIds={saved.data.handoff_ids}
        excludeId={batchId}
      />
    </div>
  )
}
