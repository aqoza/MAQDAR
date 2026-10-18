import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import {
  formatCostDecimal,
  formatPurchaseCost,
  type PurchaseCostReport as Report,
} from '@/lib/purchase-costs'

export async function PurchaseCostReport({ report, locale }: { report: Report; locale: string }) {
  const t = await getTranslations('PurchaseCosts')
  const price = report.price
  return (
    <section className="space-y-4" aria-label={t('result')}>
      <h2 className="text-section-title">{t('result')}</h2>
      <p role="status">{t(`statuses.${report.status}`)}</p>
      <p>
        {report.source.item_code} · {report.source.location_code} · {report.source.supplier_code}
      </p>
      <dl className="grid gap-3 sm:grid-cols-3">
        {(
          [
            [
              'quantity',
              `${formatCostDecimal(report.source.quantity, locale)} ${report.source.unit ?? '—'}`,
            ],
            ['orderDate', report.source.order_date ?? '—'],
            ['receiptDate', report.source.receipt_date ?? '—'],
            [
              'unitPrice',
              price?.unit_price == null
                ? '—'
                : `${formatCostDecimal(price.unit_price, locale, 3)} ${price.currency} / ${price.unit ?? '—'}`,
            ],
            ['validFrom', price?.valid_from ?? '—'],
            [
              'subtotal',
              formatPurchaseCost(
                report.subtotal,
                price?.currency ?? null,
                price?.minor_units ?? null,
                locale,
              ),
            ],
          ] as const
        ).map(([label, value]) => (
          <div className="workspace-panel" key={label}>
            <dt className="text-sm text-muted-foreground">{t(label)}</dt>
            <dd className="text-evidence-value wrap-anywhere tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {report.source.policy_recalculation_required && (
        <p className="workspace-panel font-semibold">{t('recalculate')}</p>
      )}
      <p>{t(report.price_confirmed ? 'confirmed' : 'unconfirmed')}</p>
      <p>{t('limits')}</p>
      <details className="space-y-2">
        <summary>{t('evidence')}</summary>
        <p className="text-muted-foreground">{t('priceNote')}</p>
        <p>
          {t('rounding', {
            product: formatCostDecimal(report.exact_product, locale),
            digits: price?.minor_units ?? '—',
          })}
        </p>
        <p>
          {t('priceIdentity', {
            id: price?.terms_id ?? '—',
            time: price?.updated_at ?? '—',
            raw: price?.raw_unit_price ?? '—',
          })}
        </p>
        <p>{t('cutoff', { date: report.source.cutoff })}</p>
        <p>
          {t('sourceIdentity', {
            id: report.source.delivery_id,
            fingerprint: report.source.delivery_fingerprint,
          })}
        </p>
      </details>
      <Link
        className="inline-block underline"
        href={`/replenishment/deliveries/${report.source.delivery_id}`}
      >
        {t('source')}
      </Link>
    </section>
  )
}
