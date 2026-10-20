import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { HelpDisclosure } from './help-disclosure'
import { TableScrollRegion } from './table-scroll-region'
import { ReplenishmentReport } from './replenishment-report'
import { formatScore } from '@/lib/forecast-quality'
import type { NetworkReport } from '@/lib/network-allocation'

export async function NetworkAllocationReport({
  report,
  locale,
}: {
  report: NetworkReport
  locale: string
}) {
  const [t, r, stock] = await Promise.all([
    getTranslations('NetworkAllocation'),
    getTranslations('Redistribution'),
    getTranslations('StockComparison'),
  ])
  const amount = (value: string | null | undefined) => formatScore(value, locale)
  const source = report.source_policy
  const unit = source?.unit ?? '—'
  return (
    <section className="min-w-0 space-y-4" aria-label={t('result')}>
      <h2 className="text-section-title">{t('result')}</h2>
      <p role="status">{t(`statuses.${report.status}`)}</p>
      {source && source.status !== 'available' && (
        <p role="alert">{stock(`statuses.${source.status}`)}</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(['source_surplus', 'allocated', 'remaining_surplus', 'retained_available'] as const).map(
          (key) => (
            <div key={key} className="workspace-panel min-w-0">
              <p className="text-muted-foreground">{t(key)}</p>
              <p className="text-evidence-value tabular-nums">
                {amount(report[key])} {unit}
              </p>
            </div>
          ),
        )}
      </div>
      <p className="text-sm text-muted-foreground">{t('retainedMeaning')}</p>
      <TableScrollRegion label={t('branches')}>
        <table className="w-full min-w-[44rem] text-sm">
          <caption className="sr-only">{t('branches')}</caption>
          <thead>
            <tr>
              {(['branch', 'gap', 'quantity', 'remaining', 'lane', 'status'] as const).map(
                (key) => (
                  <th key={key} className="p-2 text-start">
                    {t(key)}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {report.lines.map((line) => (
              <tr key={line.location_id} className="border-t">
                <th className="p-2 text-start">{line.location_code}</th>
                <td className="p-2 tabular-nums">
                  {amount(line.gap)} {unit}
                </td>
                <td className="p-2 tabular-nums">
                  {amount(line.quantity)} {unit}
                </td>
                <td className="p-2 tabular-nums">
                  {amount(line.remaining_gap)} {unit}
                </td>
                <td className="p-2">
                  {line.evidence.lane
                    ? t('leadDays', {
                        p50: line.evidence.lane.lead_time_days_p50,
                        p90: line.evidence.lane.lead_time_days_p90,
                      })
                    : '—'}
                </td>
                <td className="p-2">
                  {!line.active || line.location_type !== 'branch'
                    ? t('statuses.branch_location_unavailable')
                    : r(`statuses.${line.evidence.status}`)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
      {report.lines.some((line) =>
        line.evidence.destination.orders.some((order) => order.overdue || order.late),
      ) && (
        <p
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950"
        >
          {t('timingWarning')}
        </p>
      )}
      <HelpDisclosure label={t('methodTitle')}>
        <p>{t('method')}</p>
        <p>{t('planningOnly')}</p>
      </HelpDisclosure>
      <details className="workspace-panel">
        <summary className="cursor-pointer py-2 font-medium">{t('sourceEvidence')}</summary>
        <dl className="grid gap-3 py-3 sm:grid-cols-2">
          {(
            [
              ['source', report.source_location_code],
              ['item', source?.item_code],
              ['cutoff', source?.cutoff],
              ['onHand', source?.snapshot?.quantity],
              ['allocatedStock', source?.snapshot?.allocated],
              ['backorders', report.backorders],
              ['maximum', source?.maximum],
              ['stockDate', source?.snapshot?.date],
            ] as const
          ).map(([key, value]) => (
            <div key={key}>
              <dt className="text-muted-foreground">{t(key)}</dt>
              <dd className="text-evidence-value">{value ?? '—'}</dd>
            </div>
          ))}
        </dl>
        <p>
          {report.basis === 'approved'
            ? r('approved', { revision: source?.revision ?? 0 })
            : r('calculated')}
        </p>
        <p className="text-xs">
          {report.source_policy_id} · {source?.snapshot?.id}
        </p>
        {report.commitments_confirmed && report.lanes_confirmed && (
          <p className="text-sm">{t('confirmed')}</p>
        )}
      </details>
      {report.lines.map((line) => (
        <details key={line.location_id} className="workspace-panel">
          <summary className="cursor-pointer py-2 font-medium">
            {t('branchEvidence', { branch: line.location_code })}
          </summary>
          <p className="my-2 text-xs">
            {line.draft_id} · {line.evidence.lane?.id}
          </p>
          <ReplenishmentReport report={line.evidence.destination} locale={locale} />
          <Link prefetch={false} className="underline" href={`/replenishment/${line.draft_id}`}>
            {t('openDraft')}
          </Link>
        </details>
      ))}
    </section>
  )
}
