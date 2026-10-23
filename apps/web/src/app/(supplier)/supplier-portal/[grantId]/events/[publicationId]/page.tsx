import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { SupplierSummary } from '@/components/supplier-summary'
import { requireSupplierPortal } from '@/lib/supplier-portal-context'
import { createClient } from '@/lib/supabase/server'
import { supplierEventPackagesSchema } from '@/lib/supplier-portal'
export default async function SupplierEventProposal({
  params,
}: {
  params: Promise<{ grantId: string; publicationId: string }>
}) {
  const { grantId, publicationId } = await params
  const grant = await requireSupplierPortal(grantId)
  if (!grant.accepted || !z.guid().safeParse(publicationId).success) notFound()
  const [db, t] = await Promise.all([createClient(), getTranslations('SupplierPortal')])
  const response = await db.rpc('supplier_portal_event_publications', {
    p_grant_id: grant.id,
    p_publication_id: publicationId,
  })
  if (response.error) {
    if (response.error.code === 'MQ404') notFound()
    throw new Error('Supplier event proposal unavailable')
  }
  const record = supplierEventPackagesSchema.parse(response.data).rows[0]
  if (!record) notFound()
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="suppliers"
        title={t('proposalTitle')}
        back={
          <Link className="underline" href={`/supplier-portal/${grant.id}/events`}>
            {t('eventProposals')}
          </Link>
        }
      />
      <SupplierSummary summary={record.summary} />
      <p className="text-xs text-muted-foreground">{t('immutable')}</p>
      <details>
        <summary className="min-h-11 cursor-pointer py-3">{t('publicationReference')}</summary>
        <p className="break-all text-xs">{record.id}</p>
      </details>
    </div>
  )
}
