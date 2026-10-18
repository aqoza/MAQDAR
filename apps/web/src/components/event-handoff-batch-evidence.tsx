import Link from 'next/link'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { type BatchPreview } from '@/lib/event-handoff-batches'
import { formatCostDecimal, formatPurchaseCost } from '@/lib/purchase-costs'
import { formatDateOnly } from '@/lib/format'
import { TableScrollRegion } from '@/components/table-scroll-region'

export async function EventHandoffBatchEvidence({
  report,
}: {
  report: Pick<BatchPreview, 'summary' | 'lines'>
}) {
  const [t, locale, format] = await Promise.all([
    getTranslations('EventHandoffBatches'),
    getLocale(),
    getFormatter(),
  ])
  const s = report.summary
  return (
    <section className="space-y-3" aria-label={t('evidence')}>
      <h2 className="text-section-title">{t('evidence')}</h2>
      <dl className="grid gap-3 workspace-panel sm:grid-cols-2 lg:grid-cols-3">
        {[
          [t('supplier'), s.supplier_code],
          [t('location'), s.location_code],
          [t('orderDate'), formatDateOnly(format, s.order_date)],
          [t('subtotal'), formatPurchaseCost(s.subtotal, s.currency, s.minor_units, locale)],
          [
            t('baselineSubtotal'),
            formatPurchaseCost(s.baseline_subtotal, s.currency, s.minor_units, locale),
          ],
          [
            t('costIncrease'),
            formatPurchaseCost(s.cost_increase, s.currency, s.minor_units, locale),
          ],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 break-words">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted-foreground">{t('totalNote')}</p>
      <TableScrollRegion label={t('evidence')} className="workspace-table">
        <table className="w-full min-w-[64rem] text-sm">
          <caption className="sr-only">{t('evidence')}</caption>
          <thead>
            <tr>
              {(
                [
                  'item',
                  'event',
                  'quantity',
                  'baselineQuantity',
                  'cutoff',
                  'receiptDate',
                  'lineSubtotal',
                  'lineBaselineSubtotal',
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
              const cost = line.estimate
              const event = cost.source.source.draft.scenario.event
              return (
                <tr className="border-t" key={line.handoff_id}>
                  <th className="p-2 text-start">{event.source.item_code}</th>
                  <td className="max-w-64 break-words p-2">{event.input.name}</td>
                  <td className="p-2">
                    {formatCostDecimal(cost.adjusted.quantity, locale)} {event.input.unit}
                  </td>
                  <td className="p-2">
                    {formatCostDecimal(cost.baseline.quantity, locale)} {event.input.unit}
                  </td>
                  <td className="p-2">{formatDateOnly(format, event.source.cutoff)}</td>
                  <td className="p-2">{formatDateOnly(format, cost.source.receipt_date)}</td>
                  <td className="p-2">
                    {formatPurchaseCost(cost.adjusted.subtotal, s.currency, s.minor_units, locale)}
                  </td>
                  <td className="p-2">
                    {formatPurchaseCost(cost.baseline.subtotal, s.currency, s.minor_units, locale)}
                  </td>
                  <td className="p-2">
                    <Link
                      prefetch={false}
                      className="underline"
                      href={`/replenishment/events/handoffs/${line.handoff_id}`}
                    >
                      {t('inspectLine', { item: event.source.item_code })}
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
