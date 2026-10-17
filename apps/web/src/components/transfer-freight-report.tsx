import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import type { TransferFreightReport as Report } from '@/lib/transfer-freight'
import { formatCostDecimal, formatPurchaseCost } from '@/lib/purchase-costs'
import { HelpDisclosure } from './help-disclosure'
import { TransferDateReport } from './transfer-date-report'

export async function TransferFreightReport({ report, locale }: { report: Report; locale: string }) {
  const t = await getTranslations('TransferFreight')
  const source = report.source.source
  const terms = report.terms
  return (
    <section className="min-w-0 space-y-4 wrap-anywhere" aria-label={t('result')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-section-title">{t('result')}</h2>
        <p role="status">{t(`statuses.${report.status}`)}</p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-3">
        {([
          ['quantity', `${formatCostDecimal(source.quantity, locale)} ${source.destination.policy.unit ?? '—'}`],
          ['rate', terms?.rate == null ? '—' : `${formatCostDecimal(terms.rate, locale, 3)} ${terms.currency} · ${t(`bases.${terms.basis}`)}`],
          ['subtotal', formatPurchaseCost(report.subtotal, terms?.currency ?? null, terms?.minor_units ?? null, locale)],
        ] as const).map(([label, value]) => (
          <div className="workspace-panel min-w-0" key={label}>
            <dt className="text-sm text-muted-foreground">{t(label)}</dt>
            <dd className="text-page-title tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p>{t('dispatchOn', { date: report.source.dispatch?.date ?? '—', valid: terms?.valid_from ?? '—' })}</p>
      {source.destination.orders.some((order) => order.overdue || order.late) && (
        <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950">{t('existingWarning')}</p>
      )}
      {(['p50', 'p90'] as const).map((key) => report.source.receipts[key]?.timing_review_required && (
        <p role="alert" className="font-medium text-amber-900" key={key}>{t('timingWarning', { scenario: t(key) })}</p>
      ))}
      <HelpDisclosure><p>{t('method')}</p><p>{t('limits')}</p><p>{t('termsNote')}</p></HelpDisclosure>
      <details className="workspace-panel space-y-3 wrap-anywhere">
        <summary>{t('termsEvidence')}</summary>
        <p>{t(report.terms_confirmed ? 'confirmed' : 'unconfirmed')}</p>
        <p>{t('unitEvidence', { unit: terms?.unit ?? '—' })}</p>
        {terms?.basis === 'per_shipment' && <p>{t('oneShipment')}</p>}
        <p>{t('rounding', { product: formatCostDecimal(report.exact_product, locale), digits: terms?.minor_units ?? '—' })}</p>
        <p>{t('laneEvidence', { id: terms?.id ?? '—', rate: terms?.raw_rate ?? '—', time: terms?.updated_at ?? '—' })}</p>
        <p>{t('locationEvidence', { source: report.sender?.code ?? '—', sourceTime: report.sender?.updated_at ?? '—', destination: report.receiver?.code ?? '—', destinationTime: report.receiver?.updated_at ?? '—' })}</p>
      </details>
      <details className="workspace-panel min-w-0 space-y-3 wrap-anywhere">
        <summary>{t('dateEvidence')}</summary>
        <TransferDateReport report={report.source} locale={locale} />
      </details>
      <Link className="inline-block underline" href={`/replenishment/redistribution/dates/${report.scenario_id}`}>{t('source')}</Link>
    </section>
  )
}
