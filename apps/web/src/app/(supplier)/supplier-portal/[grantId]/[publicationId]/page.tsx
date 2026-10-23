import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { SupplierSummary } from '@/components/supplier-summary'
import { requireSupplierPortal } from '@/lib/supplier-portal-context'
import { createClient } from '@/lib/supabase/server'
import { supplierPackagesSchema } from '@/lib/supplier-portal'
export default async function SupplierProposal({
  params,
}: {
  params: Promise<{ grantId: string; publicationId: string }>
}) {
  const { grantId, publicationId } = await params
  const grant = await requireSupplierPortal(grantId)
  if (!grant.accepted || !z.guid().safeParse(publicationId).success) notFound()
  const db = await createClient()
  const { data, error } = await db.rpc('supplier_portal_packages', {
    p_grant_id: grant.id,
    p_publication_id: publicationId,
  })
  if (error) {
    if (error.code === 'MQ404') notFound()
    throw new Error('Supplier proposal unavailable')
  }
  const record = supplierPackagesSchema.parse(data).rows[0]
  if (!record) notFound()
  const t = await getTranslations('SupplierPortal')
  return (
    <>
      <PageHeader
        pattern="suppliers"
        title={t('proposalTitle')}
        back={
          <Link href={`/supplier-portal/${grant.id}`} className="underline">
            {t('proposals')}
          </Link>
        }
      />
      <SupplierSummary summary={record.summary} />
      <p className="text-xs text-muted-foreground">{t('immutable')}</p>
      <details>
        <summary className="min-h-11 cursor-pointer py-3">{t('publicationReference')}</summary>
        <p className="break-all text-xs">{record.id}</p>
      </details>
    </>
  )
}
