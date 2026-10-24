import { randomUUID } from 'node:crypto'
import { SupplierResponseForm } from '@/components/supplier-response-form'
import { SupplierResponses } from '@/components/supplier-responses'
import { supplierResponseHistorySchema, responsePage } from '@/lib/supplier-responses'
import { respondEventSupplier } from './actions'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { SupplierBatchSummary } from '@/components/supplier-batch-summary'
import { SupplierSummary } from '@/components/supplier-summary'
import { requireSupplierPortal } from '@/lib/supplier-portal-context'
import { createClient } from '@/lib/supabase/server'
import { supplierEventPublicationsSchema } from '@/lib/supplier-portal'
export default async function SupplierEventProposal({
  params,
  searchParams,
}: {
  searchParams: Promise<{ response_page?: string | string[] }>
  params: Promise<{ grantId: string; publicationId: string }>
}) {
  const { grantId, publicationId } = await params
  const grant = await requireSupplierPortal(grantId)
  if (!grant.accepted || !z.guid().safeParse(publicationId).success) notFound()
  const [db, t] = await Promise.all([createClient(), getTranslations('SupplierPortal')])
  const response = await db.rpc('supplier_portal_event_packages', {
    p_grant_id: grant.id,
    p_publication_id: publicationId,
  })
  if (response.error) {
    if (response.error.code === 'MQ404') notFound()
    throw new Error('Supplier event proposal unavailable')
  }
  const record = supplierEventPublicationsSchema.parse(response.data).rows[0]
  if (!record) notFound()
  const reports = await db.rpc('supplier_event_response_history', {
    p_grant_id: grant.id,
    p_kind: record.kind,
    p_publication_id: record.id,
    p_page: responsePage((await searchParams).response_page),
  })
  if (reports.error) {
    if (reports.error.code === 'MQ404') notFound()
    throw new Error('Supplier event responses unavailable')
  }
  const history = supplierResponseHistorySchema.parse(reports.data)
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="suppliers"
        title={t(record.kind === 'batch' ? 'batchProposalTitle' : 'proposalTitle')}
        back={
          <Link className="underline" href={`/supplier-portal/${grant.id}/events`}>
            {t('eventProposals')}
          </Link>
        }
      />
      {record.kind === 'batch' ? (
        <SupplierBatchSummary summary={record.summary} />
      ) : (
        <SupplierSummary summary={record.summary} />
      )}
      <SupplierResponseForm
        key={history.total}
        action={respondEventSupplier}
        fields={{
          grant_id: grant.id,
          kind: record.kind,
          publication_id: record.id,
          request_id: randomUUID(),
        }}
      />
      <SupplierResponses
        history={history}
        base={`/supplier-portal/${grant.id}/events/${record.id}`}
      />
      {record.overlap_count > 0 && (
        <section className="workspace-panel space-y-2" aria-label={t('overlap')}>
          <h2 className="text-section-title">{t('overlap')}</h2>
          <p>{t('overlapHelp', { count: record.overlap_count })}</p>
          <ul className="space-y-1">
            {record.overlaps.map((other) => (
              <li key={other.id}>
                <Link
                  className="inline-flex min-h-11 flex-wrap items-center gap-2 break-all underline"
                  href={`/supplier-portal/${grant.id}/events/${other.id}`}
                >
                  {t(other.kind)} <span className="text-xs">{other.id}</span>
                </Link>
              </li>
            ))}
          </ul>
          {record.overlap_count > record.overlaps.length && (
            <p className="text-xs">{t('overlapLimit')}</p>
          )}
        </section>
      )}
      <p className="text-xs text-muted-foreground">{t('immutable')}</p>
      <details>
        <summary className="min-h-11 cursor-pointer py-3">{t('publicationReference')}</summary>
        <p className="break-all text-xs">{record.id}</p>
      </details>
    </div>
  )
}
