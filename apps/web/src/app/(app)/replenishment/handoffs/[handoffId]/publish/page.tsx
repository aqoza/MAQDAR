import { SupplierResponses } from '@/components/supplier-responses'
import { supplierResponseHistorySchema, responsePage } from '@/lib/supplier-responses'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { SupplierSummary } from '@/components/supplier-summary'
import { SupplierPortalForm } from '@/components/supplier-portal-form'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'
import { supplierPreviewSchema, supplierSummarySchema } from '@/lib/supplier-portal'
import { publishSupplier, withdrawSupplier } from './actions'
export default async function Publication({
  params,
  searchParams,
}: {
  params: Promise<{ handoffId: string }>
  searchParams: Promise<{ response_page?: string | string[] }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { handoffId } = await params
  if (!z.guid().safeParse(handoffId).success) notFound()
  const editor = isEditorRole(context.role)
  const db = await createClient()
  const t = await getTranslations('SupplierPortal')
  const source = await db
    .from('purchase_handoffs')
    .select('id')
    .eq('organization_id', context.active.id)
    .eq('id', handoffId)
    .maybeSingle()
  if (source.error) throw new Error('Publication unavailable')
  if (!source.data) notFound()
  const saved = await db
    .from('supplier_publications')
    .select('id,summary,withdrawn_at')
    .eq('organization_id', context.active.id)
    .eq('handoff_id', handoffId)
    .maybeSingle()
  if (saved.error) throw new Error('Publication unavailable')
  const preview =
    saved.data || !editor
      ? null
      : await db.rpc('supplier_publication_preview', {
          p_organization_id: context.active.id,
          p_handoff_id: handoffId,
        })
  const report = preview && !preview.error ? supplierPreviewSchema.parse(preview.data) : null
  const response = saved.data
    ? await db.rpc('supplier_response_history_internal', {
        p_organization_id: context.active.id,
        p_kind: 'handoff',
        p_publication_id: saved.data.id,
        p_page: responsePage((await searchParams).response_page),
      })
    : null
  if (response?.error) {
    if (response.error.code === 'MQ404') notFound()
    throw new Error('Supplier responses unavailable')
  }
  const history = response ? supplierResponseHistorySchema.parse(response.data) : null
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t(editor ? 'publishTitle' : 'publicationTitle')}
        back={
          <Link className="underline" href={`/replenishment/handoffs/${handoffId}`}>
            {t('backHandoff')}
          </Link>
        }
      />
      <p>{t('publicationHelp')}</p>
      {saved.data ? (
        <>
          <p role="status">{t(saved.data.withdrawn_at ? 'withdrawn' : 'published')}</p>
          <SupplierSummary summary={supplierSummarySchema.parse(saved.data.summary)} />
          {editor && !saved.data.withdrawn_at && (
            <SupplierPortalForm
              action={withdrawSupplier}
              label="withdraw"
              fields={{
                organization_id: context.active.id,
                handoff_id: handoffId,
                publication_id: saved.data.id,
              }}
            />
          )}
        </>
      ) : report ? (
        <>
          <SupplierSummary summary={report.summary} />
          <SupplierPortalForm
            action={publishSupplier}
            label="publish"
            confirm
            fields={{
              organization_id: context.active.id,
              handoff_id: handoffId,
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
          base={`/replenishment/handoffs/${handoffId}/publish`}
        />
      )}
    </div>
  )
}
