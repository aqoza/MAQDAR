import { PageHeader } from '@/components/page-header'
import { HandoffAcknowledgements } from '@/components/handoff-acknowledgements'
import { HelpDisclosure } from '@/components/help-disclosure'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { batchPayloadSchema } from '@/lib/transfer-batches'
import { TransferBatchEvidence } from '@/components/transfer-batch-evidence'
import { TransferBatchOverlap } from '@/components/transfer-batch-overlap'

export default async function BatchDetail({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>
  searchParams: Promise<{ ack_page?: string | string[] }>
}) {
  const { ack_page } = await searchParams
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { batchId } = await params
  if (!z.guid().safeParse(batchId).success) notFound()
  const [db, t, format] = await Promise.all([
    createClient(),
    getTranslations('TransferBatches'),
    getFormatter(),
  ])
  const [saved, current] = await Promise.all([
    db
      .from('transfer_handoff_batches')
      .select('payload,handoff_ids')
      .eq('organization_id', context.active.id)
      .eq('id', batchId)
      .maybeSingle(),
    db
      .from('transfer_handoff_batch_list')
      .select('selected')
      .eq('organization_id', context.active.id)
      .eq('id', batchId)
      .maybeSingle(),
  ])
  if (saved.error || current.error) throw new Error('Batch unavailable')
  if (!saved.data || !current.data) notFound()
  const payload = batchPayloadSchema.parse(saved.data.payload)
  return (
    <div className="min-w-0 space-y-4 wrap-anywhere">
      <PageHeader
        pattern="replenishment"
        back={
          <Link className="underline" href="/replenishment/redistribution/batches">
            {t('back')}
          </Link>
        }
        title={t('detailTitle', { source: payload.summary.source_code })}
        help={
          <HelpDisclosure>
            <p>{t('description')}</p>
            <p>{t('immutableNote')}</p>
            <p>{t('csvNote')}</p>
          </HelpDisclosure>
        }
      />

      <div className="flex flex-wrap justify-between gap-2 text-sm text-muted-foreground">
        <p className="break-all">{t('batchIdentity', { id: batchId })}</p>
        <p>{t('savedAt', { time: format.dateTime(new Date(payload.created_at), 'long') })}</p>
      </div>
      <section
        className="workspace-toolbar flex flex-wrap items-center justify-between gap-3"
        aria-label={t('currentContext')}
      >
        <p role="status">{t(current.data.selected ? 'current' : 'historical')}</p>
        <div className="flex flex-wrap gap-4">
          <a download className="underline" href={`/api/transfer-batches/${batchId}/json`}>
            {t('json')}
          </a>
          <a download className="underline" href={`/api/transfer-batches/${batchId}/csv`}>
            {t('csv')}
          </a>
        </div>
      </section>
      <TransferBatchEvidence report={payload} />
      <TransferBatchOverlap
        organizationId={context.active.id}
        handoffIds={saved.data.handoff_ids}
        excludeId={batchId}
      />
      <HandoffAcknowledgements
        organizationId={context.active.id}
        recordId={batchId}
        transfer
        batch
        pageValue={ack_page}
      />
    </div>
  )
}
