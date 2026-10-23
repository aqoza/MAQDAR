import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { SupplierBatchSummary } from '@/components/supplier-batch-summary'
import { SupplierPortalForm } from '@/components/supplier-portal-form'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'
import { supplierBatchPreviewSchema, supplierBatchSummarySchema } from '@/lib/supplier-portal'
import { publishSupplierBatch, withdrawSupplierBatch } from './actions'
export default async function Publication({ params }: { params: Promise<{ batchId: string }> }) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { batchId } = await params
  if (!isEditorRole(context.role) || !z.guid().safeParse(batchId).success) notFound()
  const db = await createClient()
  const t = await getTranslations('SupplierPortal')
  const source = await db
    .from('purchase_handoff_batches')
    .select('id')
    .eq('organization_id', context.active.id)
    .eq('id', batchId)
    .maybeSingle()
  if (source.error) throw new Error('Publication unavailable')
  if (!source.data) notFound()
  const saved = await db
    .from('supplier_batch_publications')
    .select('id,summary,withdrawn_at')
    .eq('organization_id', context.active.id)
    .eq('batch_id', batchId)
    .maybeSingle()
  if (saved.error) throw new Error('Publication unavailable')
  const preview = saved.data
    ? null
    : await db.rpc('supplier_batch_publication_preview', {
        p_organization_id: context.active.id,
        p_batch_id: batchId,
      })
  const report = preview && !preview.error ? supplierBatchPreviewSchema.parse(preview.data) : null
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('publishBatchTitle')}
        back={
          <Link className="underline" href={`/replenishment/batches/${batchId}`}>
            {t('backBatch')}
          </Link>
        }
      />
      <p>{t('batchPublicationHelp')}</p>
      {saved.data ? (
        <>
          <p role="status">{t(saved.data.withdrawn_at ? 'withdrawn' : 'published')}</p>
          <SupplierBatchSummary summary={supplierBatchSummarySchema.parse(saved.data.summary)} />
          {!saved.data.withdrawn_at && (
            <SupplierPortalForm
              action={withdrawSupplierBatch}
              label="withdraw"
              fields={{
                organization_id: context.active.id,
                batch_id: batchId,
                publication_id: saved.data.id,
              }}
            />
          )}
        </>
      ) : report ? (
        <>
          <SupplierBatchSummary summary={report.summary} />
          <SupplierPortalForm
            action={publishSupplierBatch}
            label="publish"
            confirm
            fields={{
              organization_id: context.active.id,
              batch_id: batchId,
              fingerprint: report.fingerprint,
            }}
          />
        </>
      ) : (
        <p role="alert">{t('unavailable')}</p>
      )}
    </div>
  )
}
