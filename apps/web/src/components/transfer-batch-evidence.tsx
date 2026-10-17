import Link from 'next/link'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { type BatchPreview } from '@/lib/transfer-batches'
import { formatCostDecimal, formatPurchaseCost } from '@/lib/purchase-costs'
import { formatDateOnly } from '@/lib/format'

export async function TransferBatchEvidence({
  report,
}: {
  report: Pick<BatchPreview, 'summary' | 'lines'>
}) {
  const [t, locale, format] = await Promise.all([
    getTranslations('TransferBatches'),
    getLocale(),
    getFormatter(),
  ])
  const s = report.summary
  return (
    <section className="min-w-0 space-y-3">
      <h2 className="text-section-title">{t('evidence')}</h2>
      <dl className="grid min-w-0 gap-3 workspace-panel sm:grid-cols-2 lg:grid-cols-4">
        {[
          [t('source'), s.source_code],
          [t('location'), s.location_code],
          [t('dispatchDate'), formatDateOnly(format, s.dispatch_date)],
          [t('subtotal'), formatPurchaseCost(s.subtotal, s.currency, s.minor_units, locale)],
        ].map(([label, value]) => (
          <div className="min-w-0" key={label}>
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <p>{t('totalNote')}</p>
      <TableScrollRegion label={t('evidence')}>
        <table className="w-full min-w-[64rem] text-sm">
          <thead>
            <tr>
              {(
                [
                  'item',
                  'quantity',
                  'cutoff',
                  'typicalReceipt',
                  'slowReceipt',
                  'lineSubtotal',
                  'evidence',
                ] as const
              ).map((key) => (
                <th key={key} className="p-2 text-start">
                  {t(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.lines.map((line) => {
              const dates = line.estimate.source
              const policy = dates.source.destination.policy
              return (
                <tr className="border-t" key={line.handoff_id}>
                  <th className="p-2 text-start">{policy.item_code}</th>
                  <td className="p-2 whitespace-nowrap">
                    {formatCostDecimal(dates.source.quantity, locale)} {policy.unit}
                  </td>
                  <td className="p-2 whitespace-nowrap">{formatDateOnly(format, policy.cutoff)}</td>
                  <td className="p-2 whitespace-nowrap">
                    {dates.receipts.p50?.search.date
                      ? formatDateOnly(format, dates.receipts.p50.search.date)
                      : t('unavailable')}
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    {dates.receipts.p90?.search.date
                      ? formatDateOnly(format, dates.receipts.p90.search.date)
                      : t('unavailable')}
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    {formatPurchaseCost(line.estimate.subtotal, s.currency, s.minor_units, locale)}
                  </td>
                  <td className="p-2">
                    <Link
                      prefetch={false}
                      className="underline"
                      href={`/replenishment/redistribution/handoffs/${line.handoff_id}`}
                    >
                      {t('inspectLine', { item: policy.item_code })}
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </TableScrollRegion>
    </section>
  )
}
