import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import type { NetworkFreightReport as Report } from '@/lib/network-freight'
import { formatCostDecimal, formatPurchaseCost } from '@/lib/purchase-costs'
import { TableScrollRegion } from './table-scroll-region'
import { HelpDisclosure } from './help-disclosure'
import { NetworkDateReport } from './network-date-report'

export async function NetworkFreightReport({ report, locale }: { report: Report; locale: string }) {
  const [t, freight, allocation] = await Promise.all([
    getTranslations('NetworkFreight'),
    getTranslations('TransferFreight'),
    getTranslations('NetworkAllocation'),
  ])
  const unit = report.source.source.source_policy?.unit ?? '—'
  const lineStatus = (status: Report['lines'][number]['status']) => {
    if (status === 'lane_changed') return t('laneChanged')
    if (status === 'source_unavailable') return t('sourceUnavailable')
    return freight(`statuses.${status}`)
  }
  return (
    <section className="min-w-0 space-y-4 wrap-anywhere" aria-label={t('result')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-section-title">{t('result')}</h2>
        <p role="status">{t(`statuses.${report.status}`)}</p>
      </div>
      <section aria-label={t('totals')} className="grid gap-3 sm:grid-cols-3">
        {report.totals.map((total) => (
          <div className="workspace-panel min-w-0" key={total.currency}>
            <p className="text-muted-foreground">
              {t('totals')} · {total.currency}
            </p>
            <p className="text-evidence-value tabular-nums">
              {formatPurchaseCost(total.subtotal, total.currency, total.minor_units, locale)}
            </p>
          </div>
        ))}
        {report.status === 'line_unavailable' && <p>{t('noTotals')}</p>}
      </section>
      {report.source.source.lines.some((line) =>
        line.evidence.destination.orders.some((order) => order.overdue || order.late),
      ) && (
        <p
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950"
        >
          {freight('existingWarning')}
        </p>
      )}
      {report.source.lines
        .filter(
          (line) =>
            line.receipts.p50?.timing_review_required || line.receipts.p90?.timing_review_required,
        )
        .map((line) => (
          <p role="alert" className="font-medium text-amber-900" key={line.location_id}>
            {t('timingWarning', { branch: line.location_code })}
          </p>
        ))}
      <TableScrollRegion label={t('lines')}>
        <table className="w-full min-w-[56rem] text-sm">
          <caption className="sr-only">{t('lines')}</caption>
          <thead>
            <tr>
              <th className="p-2 text-start">{allocation('branch')}</th>
              <th className="p-2 text-start">{freight('quantity')}</th>
              <th className="p-2 text-start">{freight('rate')}</th>
              <th className="p-2 text-start">{freight('basis')}</th>
              <th className="p-2 text-start">{freight('subtotal')}</th>
              <th className="p-2 text-start">{allocation('status')}</th>
            </tr>
          </thead>
          <tbody>
            {report.lines.map((line) => (
              <tr className="border-t" key={line.location_id}>
                <th className="p-2 text-start">{line.location_code}</th>
                <td className="p-2 tabular-nums">
                  {formatCostDecimal(line.quantity, locale)} {unit}
                </td>
                <td className="p-2 tabular-nums">
                  {line.terms?.rate == null
                    ? '—'
                    : `${formatCostDecimal(line.terms.rate, locale, 3)} ${line.terms.currency ?? ''}`}
                </td>
                <td className="p-2">{line.terms ? freight(`bases.${line.terms.basis}`) : '—'}</td>
                <td className="p-2 tabular-nums">
                  {formatPurchaseCost(
                    line.subtotal,
                    line.terms?.currency ?? null,
                    line.terms?.minor_units ?? null,
                    locale,
                  )}
                </td>
                <td className="p-2">{lineStatus(line.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
      <HelpDisclosure>
        <p>{t('method')}</p>
        <p>{t('limits')}</p>
        <p>{t('termsNote')}</p>
      </HelpDisclosure>
      {report.lines.map((line) => (
        <details className="workspace-panel min-w-0 space-y-3 wrap-anywhere" key={line.location_id}>
          <summary className="cursor-pointer py-2 font-medium">
            {t('branchEvidence', { branch: line.location_code })}
          </summary>
          <p>{freight(report.terms_confirmed ? 'confirmed' : 'unconfirmed')}</p>
          <p>
            {freight('dispatchOn', {
              date: report.source.dispatch?.date ?? '—',
              valid: line.terms?.valid_from ?? '—',
            })}
          </p>
          <p>{freight('unitEvidence', { unit: line.terms?.unit ?? '—' })}</p>
          {line.shipment_count === 1 && <p>{freight('oneShipment')}</p>}
          <p>
            {freight('rounding', {
              product: formatCostDecimal(line.exact_product, locale),
              digits: line.terms?.minor_units ?? '—',
            })}
          </p>
          <p>
            {freight('laneEvidence', {
              id: line.terms?.id ?? '—',
              rate: line.terms?.raw_rate ?? '—',
              time: line.terms?.updated_at ?? '—',
            })}
          </p>
          <p>
            {freight('locationEvidence', {
              source: report.sender?.code ?? '—',
              sourceTime: report.sender?.updated_at ?? '—',
              destination: line.receiver?.code ?? '—',
              destinationTime: line.receiver?.updated_at ?? '—',
            })}
          </p>
        </details>
      ))}
      <details className="workspace-panel min-w-0 space-y-3 wrap-anywhere">
        <summary className="cursor-pointer py-2 font-medium">{t('dateEvidence')}</summary>
        <NetworkDateReport report={report.source} locale={locale} />
      </details>
      <Link
        className="inline-block underline"
        prefetch={false}
        href={`/replenishment/network/dates/${report.scenario_id}`}
      >
        {t('source')}
      </Link>
    </section>
  )
}
