import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { normalizeDecimal } from '@/lib/imports/normalize'
import { requireSupplierPortal } from '@/lib/supplier-portal-context'
import { createClient } from '@/lib/supabase/server'
import { supplierEventPublicationsSchema } from '@/lib/supplier-portal'
import { responsePage } from '@/lib/supplier-responses'
export default async function SupplierEventPackages({
  params,
  searchParams,
}: {
  params: Promise<{ grantId: string }>
  searchParams: Promise<{ page?: string | string[] }>
}) {
  const { grantId } = await params
  const grant = await requireSupplierPortal(grantId)
  if (!grant.accepted) redirect(`/supplier-portal/${grant.id}`)
  const [db, t] = await Promise.all([createClient(), getTranslations('SupplierPortal')])
  const page = responsePage((await searchParams).page)
  const response = await db.rpc('supplier_portal_event_packages', {
    p_grant_id: grant.id,
    p_page: page,
  })
  if (response.error) {
    if (response.error.code === 'MQ404') notFound()
    throw new Error('Supplier event proposals unavailable')
  }
  const result = supplierEventPublicationsSchema.parse(response.data)
  if (result.page !== page) redirect(`/supplier-portal/${grant.id}/events?page=${result.page}`)
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="suppliers"
        title={t('eventProposals')}
        description={`${grant.organization_name} · ${grant.supplier_code}`}
        back={
          <Link className="underline" href={`/supplier-portal/${grant.id}`}>
            {t('ordinaryProposals')}
          </Link>
        }
      />
      <p>{t('planningOnly')}</p>
      <TableScrollRegion label={t('eventProposals')}>
        <table className="w-full text-sm">
          <caption className="sr-only">{t('eventProposals')}</caption>
          <thead>
            <tr>
              {(
                [
                  'packageKind',
                  'item_code',
                  'location_code',
                  'quantity',
                  'unit',
                  'receipt_date',
                  'subtotal',
                  'actions',
                ] as const
              ).map((field) => (
                <th key={field} scope="col" className="p-3 text-start text-xs">
                  {t(field)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={row.id} className="border-t align-top">
                <td className="p-3">{t(row.kind)}</td>
                <th scope="row" className="min-w-36 p-3 text-start font-normal">
                  <bdi className="break-all">
                    {row.kind === 'handoff'
                      ? row.summary.item_code
                      : t('lineCount', { count: row.summary.lines.length })}
                  </bdi>
                </th>
                <td className="p-3">
                  <bdi>{row.summary.location_code}</bdi>
                </td>
                <td className="p-3 whitespace-nowrap">
                  {row.kind === 'handoff' ? normalizeDecimal(row.summary.quantity) : t('perLine')}
                </td>
                <td className="p-3">{row.kind === 'handoff' ? row.summary.unit : t('perLine')}</td>
                <td className="p-3 whitespace-nowrap">
                  {row.kind === 'handoff' ? row.summary.receipt_date : t('perLine')}
                </td>
                <td className="p-3 whitespace-nowrap">
                  {row.summary.subtotal} {row.summary.currency}
                </td>
                <td className="p-3">
                  <Link
                    prefetch={false}
                    className="inline-flex min-h-11 items-center underline"
                    href={`/supplier-portal/${grant.id}/events/${row.id}`}
                  >
                    {t('inspect')}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
      {!result.rows.length && <p>{t('emptyEvents')}</p>}
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
    </div>
  )
}
