import Link from 'next/link'
import { normalizeDecimal } from '@/lib/imports/normalize'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { SupplierPortalForm } from '@/components/supplier-portal-form'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { requireSupplierPortal } from '@/lib/supplier-portal-context'
import { createClient } from '@/lib/supabase/server'
import { supplierPublicationsSchema } from '@/lib/supplier-portal'
import { acceptSupplier } from '../actions'
export default async function SupplierPackages({
  params,
  searchParams,
}: {
  params: Promise<{ grantId: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const { grantId } = await params
  const grant = await requireSupplierPortal(grantId)
  const t = await getTranslations('SupplierPortal')
  const header = (
    <PageHeader
      pattern="suppliers"
      title={`${grant.organization_name} · ${grant.supplier_code}`}
      description={t('planningOnly')}
      back={
        <Link href="/supplier-portal" className="underline">
          {t('title')}
        </Link>
      }
    />
  )
  if (!grant.accepted)
    return (
      <>
        {header}
        <p>{t('acceptHelp')}</p>
        <SupplierPortalForm
          label="accept"
          action={acceptSupplier}
          fields={{ grant_id: grant.id }}
        />
      </>
    )
  const raw = await searchParams
  const page = Math.min(100000, Math.max(1, Math.trunc(Number(raw.page) || 1)))
  const db = await createClient()
  const { data, error } = await db.rpc('supplier_portal_publications', {
    p_grant_id: grant.id,
    p_page: page,
  })
  if (error) {
    if (error.code === 'MQ404') notFound()
    throw new Error('Supplier proposals unavailable')
  }
  const result = supplierPublicationsSchema.parse(data)
  if (result.page !== page) redirect(`/supplier-portal/${grant.id}?page=${result.page}`)
  return (
    <>
      {header}
      <TableScrollRegion label={t('proposals')}>
        <table className="w-full text-sm">
          <thead>
            <tr>
              {(
                [
                  'packageKind',
                  'item_code',
                  'quantity',
                  'unit',
                  'receipt_date',
                  'subtotal',
                  'overlap',
                  'actions',
                ] as const
              ).map((k) => (
                <th className="p-3 text-start text-xs" key={k}>
                  {t(k)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="p-3">{t(p.kind)}</td>
                <td className="p-3">
                  <bdi>
                    {p.kind === 'handoff'
                      ? p.summary.item_code
                      : t('lineCount', { count: p.summary.lines.length })}
                  </bdi>
                </td>
                <td className="p-3">
                  {p.kind === 'handoff' ? normalizeDecimal(p.summary.quantity) : '\u2014'}
                </td>
                <td className="p-3">{p.kind === 'handoff' ? p.summary.unit : '\u2014'}</td>
                <td className="p-3 whitespace-nowrap">
                  {p.kind === 'handoff' ? p.summary.receipt_date : t('perLine')}
                </td>
                <td className="p-3 whitespace-nowrap">
                  {p.summary.subtotal} {p.summary.currency}
                </td>
                <td className="p-3">{p.overlap_count}</td>
                <td className="p-3">
                  <Link
                    className="inline-flex min-h-11 items-center underline"
                    href={`/supplier-portal/${grant.id}/${p.id}`}
                  >
                    {t('inspect')}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
      {!result.rows.length && <p>{t('empty')}</p>}
      <nav aria-label={t('page')} className="flex flex-wrap items-center gap-4">
        <span>{t('count', { count: result.total })}</span>
        {page > 1 && (
          <Link className="min-h-11 py-3 underline" href={`?page=${page - 1}`}>
            {t('previous')}
          </Link>
        )}
        {page * result.size < result.total && (
          <Link className="min-h-11 py-3 underline" href={`?page=${page + 1}`}>
            {t('next')}
          </Link>
        )}
      </nav>
    </>
  )
}
