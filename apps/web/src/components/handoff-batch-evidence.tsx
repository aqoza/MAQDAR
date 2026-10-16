import Link from 'next/link'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { type BatchPreview } from '@/lib/handoff-batches'
import { formatCostDecimal, formatPurchaseCost } from '@/lib/purchase-costs'
import { formatDateOnly } from '@/lib/format'

export async function HandoffBatchEvidence({
  report,
}: {
  report: Pick<BatchPreview, 'summary' | 'lines'>
}) {
  const [t, locale, format] = await Promise.all([
    getTranslations('HandoffBatches'),
    getLocale(),
    getFormatter(),
  ])
  const s = report.summary
  return (
    <section className="space-y-3" aria-label={t('evidence')}>
      <h2 className="text-xl font-semibold">{t('evidence')}</h2>
      <dl className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [t('supplier'), s.supplier_code],
          [t('location'), s.location_code],
          [t('orderDate'), formatDateOnly(format, s.order_date)],
          [t('subtotal'), formatPurchaseCost(s.subtotal, s.currency, s.minor_units, locale)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <p>{t('totalNote')}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('evidence')}</caption>
          <thead>
            <tr>
              {(
                ['item', 'quantity', 'cutoff', 'receiptDate', 'lineSubtotal', 'evidence'] as const
              ).map((key) => (
                <th key={key} className="p-2 text-start">
                  {t(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.lines.map((line) => (
              <tr className="border-t" key={line.handoff_id}>
                <th className="p-2 text-start">{line.estimate.source.item_code}</th>
                <td className="p-2">
                  {formatCostDecimal(line.estimate.source.quantity, locale)}{' '}
                  {line.estimate.source.unit}
                </td>
                <td className="p-2">{formatDateOnly(format, line.estimate.source.cutoff)}</td>
                <td className="p-2">{formatDateOnly(format, line.estimate.source.receipt_date)}</td>
                <td className="p-2">
                  {formatPurchaseCost(line.estimate.subtotal, s.currency, s.minor_units, locale)}
                </td>
                <td className="p-2">
                  <Link
                    prefetch={false}
                    className="underline"
                    href={`/replenishment/handoffs/${line.handoff_id}`}
                  >
                    {t('inspectLine', { item: line.estimate.source.item_code })}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
