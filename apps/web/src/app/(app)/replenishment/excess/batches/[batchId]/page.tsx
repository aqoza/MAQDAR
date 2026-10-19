import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { ExcessDispositionBatchesHelp } from '@/components/excess-disposition-batches-help'
import { ExcessDispositionBatchEvidence } from '@/components/excess-disposition-batch-evidence'
import { ExcessDispositionBatchOverlap } from '@/components/excess-disposition-batch-overlap'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { batchPayloadSchema } from '@/lib/excess-disposition-batches'

export default async function BatchDetail({ params }: { params: Promise<{ batchId: string }> }) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { batchId } = await params
  if (!z.guid().safeParse(batchId).success) notFound()
  const [db, t, format] = await Promise.all([
    createClient(),
    getTranslations('ExcessDispositionBatches'),
    getFormatter(),
  ])
  const [saved, current] = await Promise.all([
    db
      .from('excess_disposition_handoff_batches')
      .select('payload,handoff_ids')
      .eq('organization_id', context.active.id)
      .eq('id', batchId)
      .maybeSingle(),
    db
      .from('excess_disposition_handoff_batch_list')
      .select('selection')
      .eq('organization_id', context.active.id)
      .eq('id', batchId)
      .maybeSingle(),
  ])
  if (saved.error || current.error) throw new Error('Disposition batch unavailable')
  if (!saved.data || !current.data) notFound()
  const payload = batchPayloadSchema.parse(saved.data.payload)
  const selection = z.enum(['current', 'historical', 'unavailable']).parse(current.data.selection)
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('detailTitle', { location: payload.summary.location_code })}
        description={t('context')}
        back={
          <Link className="underline" href="/replenishment/excess/batches">
            {t('back')}
          </Link>
        }
        help={<ExcessDispositionBatchesHelp />}
        actions={
          <>
            {(['json', 'csv'] as const).map((format) => (
              <a
                key={format}
                download
                className="rounded-md border bg-background px-3 py-2"
                href={`/api/excess-disposition-batches/${batchId}/${format}`}
              >
                {t(format)}
              </a>
            ))}
          </>
        }
      />
      <section className="workspace-panel space-y-2" aria-label={t('currentContext')}>
        <h2 className="text-section-title">{t('currentContext')}</h2>
        <p role="status">{t(selection === 'unavailable' ? 'contextUnavailable' : selection)}</p>
        <p className="text-xs text-muted-foreground">{t('contextNote')}</p>
        <p>{t('savedAt', { time: format.dateTime(new Date(payload.created_at), 'long') })}</p>
        <p className="break-all text-xs text-muted-foreground">
          {t('batchIdentity', { id: batchId })}
        </p>
      </section>
      <ExcessDispositionBatchEvidence report={payload} />
      <ExcessDispositionBatchOverlap
        organizationId={context.active.id}
        handoffIds={saved.data.handoff_ids}
        excludeId={batchId}
      />
    </div>
  )
}
