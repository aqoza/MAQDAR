import { normalizeDecimal } from '@/lib/imports/normalize'
import { getTranslations } from 'next-intl/server'
import type { SupplierSummary as Summary } from '@/lib/supplier-portal'
export async function SupplierSummary({ summary }: { summary: Summary }) {
  const t = await getTranslations('SupplierPortal')
  const fields = [
    'item_code',
    'supplier_code',
    'location_code',
    'quantity',
    'unit',
    'order_date',
    'receipt_date',
    'unit_price',
    'currency',
    'subtotal',
  ] as const
  return (
    <section className="workspace-panel space-y-3" aria-label={t('summary')}>
      <h2 className="text-section-title">{t('summary')}</h2>
      <p className="text-muted-foreground">{t('planningOnly')}</p>
      <dl className="grid min-w-0 grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {fields.map((field) => (
          <div key={field} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t(field)}</dt>
            <dd className="text-evidence-value break-words">
              <bdi>{field === 'quantity' ? normalizeDecimal(summary[field]) : summary[field]}</bdi>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
