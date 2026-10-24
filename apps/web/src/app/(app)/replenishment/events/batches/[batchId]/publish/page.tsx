import { SupplierResponses } from '@/components/supplier-responses'
import { supplierResponseHistorySchema, responsePage } from '@/lib/supplier-responses'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { SupplierBatchSummary } from '@/components/supplier-batch-summary'
import { SupplierPortalForm } from '@/components/supplier-portal-form'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'
import { supplierBatchPreviewSchema, supplierBatchSummarySchema } from '@/lib/supplier-portal'
import { publishEventBatchSupplier, withdrawEventBatchSupplier } from './actions'
export default async function EventBatchPublication({
  params,
  searchParams,
}: {
  searchParams: Promise<{ response_page?: string | string[] }>
  params: Promise<{ batchId: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { batchId } = await params
  if (!z.guid().safeParse(batchId).success) notFound()
  const editor = isEditorRole(context.role)
  const [db, t] = await Promise.all([createClient(), getTranslations('SupplierPortal')])
  const source = await db
    .from('event_purchase_handoff_batches')
    .select('id')
    .eq('organization_id', context.active.id)
    .eq('id', batchId)
    .maybeSingle()
  if (source.error) throw new Error('Event publication unavailable')
  if (!source.data) notFound()
  const saved = await db
    .from('supplier_event_batch_publications')
    .select('id,summary,created_at,withdrawn_at')
    .eq('organization_id', context.active.id)
    .eq('batch_id', batchId)
    .maybeSingle()
  if (saved.error) throw new Error('Event publication unavailable')
  const preview =
    saved.data || !editor
      ? null
      : await db.rpc('supplier_event_batch_publication_preview', {
          p_organization_id: context.active.id,
          p_batch_id: batchId,
        })
  const report = preview && !preview.error ? supplierBatchPreviewSchema.parse(preview.data) : null
  const reports = saved.data
    ? await db.rpc('supplier_event_response_history_internal', {
        p_organization_id: context.active.id,
        p_kind: 'batch',
        p_publication_id: saved.data.id,
        p_page: responsePage((await searchParams).response_page),
      })
    : null
  if (reports?.error) {
    if (reports.error.code === 'MQ404') notFound()
    throw new Error('Supplier event responses unavailable')
  }
  const history = reports ? supplierResponseHistorySchema.parse(reports.data) : null
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('eventBatchPublishTitle')}
        back={
          <Link className="underline" href={`/replenishment/events/batches/${batchId}`}>
            {t('backBatch')}
          </Link>
        }
        help={
          <HelpDisclosure>
            <p>{t('eventBatchPublicationHelp')}</p>
          </HelpDisclosure>
        }
      />
      <p>{t('eventSelection')}</p>
      {saved.data ? (
        <>
          <p role="status">{t(saved.data.withdrawn_at ? 'withdrawn' : 'published')}</p>
          <SupplierBatchSummary summary={supplierBatchSummarySchema.parse(saved.data.summary)} />
          {editor && !saved.data.withdrawn_at && (
            <SupplierPortalForm
              action={withdrawEventBatchSupplier}
              label="withdraw"
              fields={{
                organization_id: context.active.id,
                batch_id: batchId,
                publication_id: saved.data.id,
              }}
            />
          )}
          <details>
            <summary className="min-h-11 cursor-pointer py-3">{t('publicationReference')}</summary>
            <p className="break-all text-xs">{saved.data.id}</p>
            <p className="text-xs">{saved.data.created_at}</p>
          </details>
        </>
      ) : report ? (
        <>
          <SupplierBatchSummary summary={report.summary} />
          <SupplierPortalForm
            action={publishEventBatchSupplier}
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
        <p role="alert">{t(editor ? 'unavailable' : 'notPublished')}</p>
      )}
      {history && (
        <SupplierResponses
          history={history}
          base={`/replenishment/events/batches/${batchId}/publish`}
        />
      )}
    </div>
  )
}
