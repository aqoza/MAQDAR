import { getTranslations } from 'next-intl/server'
import { normalizeDecimal } from '@/lib/imports/normalize'
import { TableScrollRegion } from '@/components/table-scroll-region'
import type { SupplierBatchSummary as Summary } from '@/lib/supplier-portal'
export async function SupplierBatchSummary({ summary }: { summary: Summary }) {
  const t = await getTranslations('SupplierPortal')
  const fields = ['supplier_code', 'location_code', 'order_date', 'currency', 'subtotal'] as const
  const columns = [
    'item_code',
    'quantity',
    'unit',
    'order_date',
    'receipt_date',
    'unit_price',
    'subtotal',
  ] as const
  return (
    <section className="workspace-panel space-y-4" aria-label={t('batchSummary')}>
      <h2 className="text-section-title">{t('batchSummary')}</h2>
      <p className="text-muted-foreground">{t('planningOnly')}</p>
      <dl className="grid min-w-0 grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {fields.map((field) => (
          <div key={field} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t(field)}</dt>
            <dd className="text-evidence-value break-words">
              <bdi>{summary[field]}</bdi>
            </dd>
          </div>
        ))}
      </dl>
      <TableScrollRegion label={t('batchLines')}>
        <table className="w-full text-sm">
          <thead>
            <tr>
              {columns.map((field) => (
                <th className="p-3 text-start text-xs" key={field}>
                  {t(field)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.lines.map((line, index) => (
              <tr className="border-t" key={index}>
                {columns.map((field) => (
                  <td className="p-3 whitespace-nowrap" key={field}>
                    <bdi>{field === 'quantity' ? normalizeDecimal(line[field]) : line[field]}</bdi>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
      <p className="text-xs text-muted-foreground">
        {t('batchTotalHelp', { count: summary.lines.length })}
      </p>
    </section>
  )
}
