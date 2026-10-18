import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { HelpDisclosure } from './help-disclosure'
import { TableScrollRegion } from './table-scroll-region'
import { EventDeliveryReport } from './event-delivery-report'
import { EventDeliveryWarnings } from './event-delivery-warnings'
import type { EventCostReport as Report } from '@/lib/event-costs'
import { isZeroQuantity } from '@/lib/event-deliveries'
import { formatCostDecimal, formatPurchaseCost } from '@/lib/purchase-costs'

export function EventCostReport({ report }: { report: Report }) {
  const t = useTranslations('EventCosts')
  const locale = useLocale()
  const price = report.price
  const source = report.source
  const unit = source.source.draft.scenario.event.input.unit
  const cost = (value: string | null) =>
    formatPurchaseCost(value, price?.currency ?? null, price?.minor_units ?? null, locale)
  return (
    <section className="space-y-3" aria-label={t('comparison')}>
      <p role="status">{t(`statuses.${report.status}`)}</p>
      <div className="workspace-panel">
        <TableScrollRegion label={t('comparison')}>
          <table className="w-full min-w-[34rem] text-sm">
            <caption className="sr-only">{t('comparison')}</caption>
            <thead>
              <tr>
                {(['side', 'quantity', 'orderDate', 'subtotal'] as const).map((key) => (
                  <th key={key} className="p-3 text-start text-xs">
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(['baseline', 'adjusted'] as const).map((side) => (
                <tr key={side} className="border-t">
                  <th scope="row" className="p-3 text-start font-medium">
                    {t(side)}
                  </th>
                  <td className="p-3 tabular-nums">
                    <bdi>
                      {formatCostDecimal(report[side].quantity, locale, 3)} {unit}
                    </bdi>
                  </td>
                  <td className="p-3 tabular-nums">
                    {isZeroQuantity(report[side].quantity)
                      ? t('noOrder')
                      : (source.order_date ?? '—')}
                  </td>
                  <td className="p-3 tabular-nums">
                    <bdi>
                      {report.status === 'no_order_needed'
                        ? t('noOrder')
                        : cost(report[side].subtotal)}
                    </bdi>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollRegion>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="min-w-0 space-y-1 workspace-panel">
          <h2 className="text-subsection-title">{t('increase')}</h2>
          <p className="break-words tabular-nums">
            <bdi>
              {report.status === 'no_order_needed' ? t('noOrder') : cost(report.cost_increase)}
            </bdi>
          </p>
        </div>
        <div className="min-w-0 space-y-1 workspace-panel">
          <h2 className="text-subsection-title">{t('unitPrice')}</h2>
          <p className="break-words tabular-nums">
            <bdi>
              {price?.unit_price === null || !price
                ? '—'
                : `${formatCostDecimal(price.unit_price, locale, 3)} ${price.currency} / ${price.unit ?? '—'}`}
            </bdi>
          </p>
        </div>
        <div className="min-w-0 space-y-1 workspace-panel">
          <h2 className="text-subsection-title">{t('receiptDate')}</h2>
          <p className="tabular-nums">{source.receipt_date ?? t('noOrder')}</p>
        </div>
      </div>
      <EventDeliveryWarnings report={source} />
      <p className="text-sm text-muted-foreground">{t('planningOnly')}</p>
      <HelpDisclosure label={t('priceEvidence')}>
        <p>{t('formula')}</p>
        <p>{t('priceNote')}</p>
        {price && (
          <dl className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ['validFrom', price.valid_from ?? '—'],
                ['priceIdentity', price.terms_id],
                ['priceUpdated', price.updated_at],
                ['currencyPrecision', String(price.minor_units ?? '—')],
                ['baselineProduct', formatCostDecimal(report.baseline.exact_product, locale)],
                ['adjustedProduct', formatCostDecimal(report.adjusted.exact_product, locale)],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className="min-w-0">
                <dt className="font-medium">{t(key)}</dt>
                <dd className="break-words">
                  <bdi>{value}</bdi>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </HelpDisclosure>
      <HelpDisclosure label={t('sourceEvidence')}>
        <Link
          className="underline"
          href={`/replenishment/events/deliveries/${report.input.delivery_id}`}
        >
          {t('source')}
        </Link>
        <EventDeliveryReport report={source} />
      </HelpDisclosure>
    </section>
  )
}
