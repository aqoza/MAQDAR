import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { getSupplierPortals } from '@/lib/supplier-portal-context'
export default async function SupplierPortals() {
  const portals = await getSupplierPortals()
  const t = await getTranslations('SupplierPortal')
  return (
    <>
      <PageHeader pattern="suppliers" title={t('title')} description={t('portalHelp')} />
      {!portals.length ? (
        <p>{t('noAccess')}</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {portals.map((g) => (
            <li className="workspace-panel min-w-0 space-y-2" key={g.id}>
              <p className="text-evidence-value break-words">
                {g.organization_name} · {g.supplier_code}
              </p>
              <p>{t(g.accepted ? 'active' : 'pending')}</p>
              <Link
                className="inline-flex min-h-11 items-center underline"
                href={`/supplier-portal/${g.id}`}
              >
                {t('open')}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
