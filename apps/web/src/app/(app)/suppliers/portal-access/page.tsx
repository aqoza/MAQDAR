import Link from 'next/link'
import Form from 'next/form'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { SupplierPortalForm } from '@/components/supplier-portal-form'
import { HelpDisclosure } from '@/components/help-disclosure'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { inviteSupplier, revokeSupplier } from './actions'
export default async function SupplierAccess({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; supplier?: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  if (!['owner', 'admin'].includes(context.role ?? '')) notFound()
  const raw = await searchParams
  const page = Math.min(100000, Math.max(1, Math.trunc(Number(raw.page) || 1)))
  const supplier = typeof raw.supplier === 'string' ? raw.supplier.slice(0, 64) : ''
  const db = await createClient()
  const t = await getTranslations('SupplierPortal')
  const result = await db
    .from('supplier_portal_grants')
    .select('id,email,accepted_at,revoked_at,expires_at,suppliers!inner(code)', { count: 'exact' })
    .eq('organization_id', context.active.id)
    .order('created_at', { ascending: false })
    .order('id')
    .range((page - 1) * 25, page * 25 - 1)
  if (result.error) throw new Error('Supplier grants unavailable')
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="suppliers"
        title={t('accessTitle')}
        back={
          <Link href="/suppliers" className="underline">
            {t('backSuppliers')}
          </Link>
        }
        help={
          <HelpDisclosure>
            <p>{t('accessHelp')}</p>
          </HelpDisclosure>
        }
      />
      <section className="workspace-panel space-y-3">
        <h2 className="text-section-title">{t('invite')}</h2>
        <SupplierPortalForm
          action={inviteSupplier}
          fields={{ organization_id: context.active.id }}
          label="invite"
          invite
          supplierCode={supplier}
        />
      </section>
      <TableScrollRegion label={t('accessTitle')}>
        <table className="w-full text-start text-sm">
          <thead>
            <tr>
              {(['supplier_code', 'email', 'status', 'actions'] as const).map((k) => (
                <th className="p-3 text-start text-xs" key={k}>
                  {t(k)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.data.map((g) => (
              <tr key={g.id} className="border-t">
                <td className="p-3">{g.suppliers.code}</td>
                <td className="max-w-64 break-words p-3">{g.email}</td>
                <td className="p-3">
                  {t(
                    g.revoked_at
                      ? 'revoked'
                      : g.accepted_at
                        ? 'active'
                        : new Date(g.expires_at) < new Date()
                          ? 'expired'
                          : 'pending',
                  )}
                </td>
                <td className="p-3">
                  {!g.revoked_at && (
                    <SupplierPortalForm
                      action={revokeSupplier}
                      label="revoke"
                      fields={{ organization_id: context.active!.id, grant_id: g.id }}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
      {!result.data.length && <p>{t('emptyGrants')}</p>}
      <Form action="/suppliers/portal-access" className="flex flex-wrap items-center gap-3">
        <label>
          {t('page')}
          <input
            className="ms-2 w-24 rounded border p-2"
            name="page"
            type="number"
            min="1"
            max={Math.max(1, Math.ceil((result.count ?? 0) / 25))}
            defaultValue={page}
          />
        </label>
        <button className="min-h-11 rounded border px-3">{t('go')}</button>
        <span>{t('count', { count: result.count ?? 0 })}</span>
      </Form>
    </div>
  )
}
