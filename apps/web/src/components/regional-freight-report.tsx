import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import type { RegionalFreightReport as Report } from '@/lib/regional-freight'
import { formatCostDecimal, formatPurchaseCost } from '@/lib/purchase-costs'
import { TableScrollRegion } from './table-scroll-region'
import { HelpDisclosure } from './help-disclosure'
import { RegionalDateReport } from './regional-date-report'

export async function RegionalFreightReport({
  report,
  locale,
}: {
  report: Report
  locale: string
}) {
  const [t, freight, allocation] = await Promise.all([
    getTranslations('RegionalFreight'),
    getTranslations('RegionalFreight.labels'),
    getTranslations('RegionalSourcing'),
  ])
  const isolate = (value: string | null | undefined) => `\u2068${value ?? '—'}\u2069`
  const unit = report.source.source.destination.policy.unit ?? '—'
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
      {report.source.source.destination.orders.some((order) => order.overdue || order.late) && (
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
              <th className="p-2 text-start text-xs font-medium">{allocation('source')}</th>
              <th className="p-2 text-start text-xs font-medium">{freight('quantity')}</th>
              <th className="p-2 text-start text-xs font-medium">{t('dispatch')}</th>
              <th className="p-2 text-start text-xs font-medium">{freight('rate')}</th>
              <th className="p-2 text-start text-xs font-medium">{freight('basis')}</th>
              <th className="p-2 text-start text-xs font-medium">{freight('subtotal')}</th>
              <th className="p-2 text-start text-xs font-medium">{allocation('status')}</th>
            </tr>
          </thead>
          <tbody>
            {report.lines.map((line) => (
              <tr className="border-t" key={line.location_id}>
                <th className="p-2 text-start whitespace-nowrap">
                  <bdi>{line.location_code}</bdi>
                </th>
                <td className="p-2 tabular-nums">
                  <bdi>
                    {formatCostDecimal(line.quantity, locale)} {unit}
                  </bdi>
                </td>
                <td className="p-2 whitespace-nowrap">
                  <bdi>{line.dispatch_date ?? '—'}</bdi>
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
        <details
          className="workspace-panel min-w-0 p-3! wrap-anywhere open:space-y-3"
          key={line.location_id}
        >
          <summary className="min-h-11 cursor-pointer py-2 font-medium">
            {t('branchEvidence', { branch: line.location_code })}
          </summary>
          <p>{freight(report.terms_confirmed ? 'confirmed' : 'unconfirmed')}</p>
          <p>
            {freight('dispatchOn', {
              date: isolate(line.dispatch_date),
              valid: isolate(line.terms?.valid_from),
            })}
          </p>
          <p>{freight('unitEvidence', { unit: line.terms?.unit ?? '—' })}</p>
          {line.shipment_count === 1 && <p>{freight('oneShipment')}</p>}
          <p>
            {freight('rounding', {
              product: isolate(formatCostDecimal(line.exact_product, locale)),
              digits: line.terms?.minor_units ?? '—',
            })}
          </p>
          <p>
            {freight('laneEvidence', {
              id: isolate(line.terms?.id),
              rate: isolate(line.terms?.raw_rate),
              time: isolate(line.terms?.updated_at),
            })}
          </p>
          <p>
            {freight('locationEvidence', {
              source: isolate(line.sender?.code),
              sourceTime: isolate(line.sender?.updated_at),
              destination: isolate(report.receiver?.code),
              destinationTime: isolate(report.receiver?.updated_at),
            })}
          </p>
        </details>
      ))}
      <details className="workspace-panel min-w-0 p-3! wrap-anywhere open:space-y-3">
        <summary className="min-h-11 cursor-pointer py-2 font-medium">{t('dateEvidence')}</summary>
        <RegionalDateReport report={report.source} />
      </details>
      <Link
        className="inline-block underline"
        prefetch={false}
        href={`/replenishment/regional-stock/sourcing/dates/${report.scenario_id}`}
      >
        {t('source')}
      </Link>
    </section>
  )
}
