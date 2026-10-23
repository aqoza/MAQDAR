import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { SupplierBatchSummary } from '@/components/supplier-batch-summary'
import { SupplierSummary } from '@/components/supplier-summary'
import { requireSupplierPortal } from '@/lib/supplier-portal-context'
import { createClient } from '@/lib/supabase/server'
import { supplierPublicationsSchema } from '@/lib/supplier-portal'
export default async function SupplierProposal({
  params,
}: {
  params: Promise<{ grantId: string; publicationId: string }>
}) {
  const { grantId, publicationId } = await params
  const grant = await requireSupplierPortal(grantId)
  if (!grant.accepted || !z.guid().safeParse(publicationId).success) notFound()
  const db = await createClient()
  const { data, error } = await db.rpc('supplier_portal_publications', {
    p_grant_id: grant.id,
    p_publication_id: publicationId,
  })
  if (error) {
    if (error.code === 'MQ404') notFound()
    throw new Error('Supplier proposal unavailable')
  }
  const record = supplierPublicationsSchema.parse(data).rows[0]
  if (!record) notFound()
  const t = await getTranslations('SupplierPortal')
  return (
    <>
      <PageHeader
        pattern="suppliers"
        title={t(record.kind === 'batch' ? 'batchProposalTitle' : 'proposalTitle')}
        back={
          <Link href={`/supplier-portal/${grant.id}`} className="underline">
            {t('proposals')}
          </Link>
        }
      />
      {record.kind === 'batch' ? (
        <SupplierBatchSummary summary={record.summary} />
      ) : (
        <SupplierSummary summary={record.summary} />
      )}
      {record.overlap_count > 0 && (
        <section className="workspace-panel space-y-2" aria-label={t('overlap')}>
          <h2 className="text-section-title">{t('overlap')}</h2>
          <p>{t('overlapHelp', { count: record.overlap_count })}</p>
          <ul className="space-y-1">
            {record.overlaps.map((other) => (
              <li key={other.id}>
                <Link
                  className="inline-flex min-h-11 flex-wrap items-center gap-2 break-all underline"
                  href={`/supplier-portal/${grant.id}/${other.id}`}
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
    </>
  )
}
