import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import type { NetworkDateReport as Report } from '@/lib/network-dates'
import { formatScore } from '@/lib/forecast-quality'
import { CalendarEvidence } from './calendar-evidence'
import { NetworkAllocationReport } from './network-allocation-report'
import { TableScrollRegion } from './table-scroll-region'
import { HelpDisclosure } from './help-disclosure'

export async function NetworkDateReport({ report, locale }: { report: Report; locale: string }) {
  const [t, dates, allocation] = await Promise.all([
    getTranslations('NetworkDates'),
    getTranslations('TransferDates'),
    getTranslations('NetworkAllocation'),
  ])
  const unit = report.source.source_policy?.unit ?? '—'
  const lineStatus = (status: Report['lines'][number]['status']) => {
    if (status === 'lane_changed') return t('laneChanged')
    if (status === 'source_unavailable') return t('sourceUnavailable')
    return dates(`statuses.${status}`)
  }
  return (
    <section className="min-w-0 space-y-4" aria-label={t('result')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-section-title">{t('result')}</h2>
        <p role="status">{t(`statuses.${report.status}`)}</p>
      </div>
      <div className="workspace-panel flex flex-wrap justify-between gap-3">
        <div>
          <p className="text-muted-foreground">{dates('dispatch')}</p>
          <p className="text-evidence-value">{report.dispatch?.date ?? '—'}</p>
          <p>{dates('requestedOn', { date: report.requested_date })}</p>
          {report.dispatch && <p>{dates(`searchStatuses.${report.dispatch.status}`)}</p>}
        </div>
        <div>
          <p className="text-muted-foreground">{t('fixedQuantity')}</p>
          <p className="text-evidence-value">
            {formatScore(report.source.allocated, locale)} {unit}
          </p>
        </div>
      </div>
      {report.source.lines.some((line) =>
        line.evidence.destination.orders.some((order) => order.overdue || order.late),
      ) && (
        <p
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950"
        >
          {dates('existingWarning')}
        </p>
      )}
      <TableScrollRegion label={t('branches')}>
        <table className="w-full min-w-[52rem] text-sm">
          <caption className="sr-only">{t('branches')}</caption>
          <thead>
            <tr>
              <th className="p-2 text-start">{allocation('branch')}</th>
              <th className="p-2 text-start">{allocation('quantity')}</th>
              <th className="p-2 text-start">{dates('p50')}</th>
              <th className="p-2 text-start">{dates('p90')}</th>
              <th className="p-2 text-start">{t('reference')}</th>
              <th className="p-2 text-start">{allocation('status')}</th>
            </tr>
          </thead>
          <tbody>
            {report.lines.map((line) => (
              <tr key={line.location_id} className="border-t">
                <th className="p-2 text-start">{line.location_code}</th>
                <td className="p-2 tabular-nums">
                  {formatScore(line.quantity, locale)} {unit}
                </td>
                {(['p50', 'p90'] as const).map((key) => (
                  <td key={key} className="p-2">
                    <p className="whitespace-nowrap tabular-nums">
                      {line.receipts[key]?.search.date ?? '—'}
                    </p>
                    {line.receipts[key]?.timing_review_required && (
                      <p role="alert" className="font-medium text-amber-900">
                        {t('timingWarning')}
                      </p>
                    )}
                    {line.receipts[key] && line.receipts[key].search.status !== 'resolved' && (
                      <p>{dates(`searchStatuses.${line.receipts[key].search.status}`)}</p>
                    )}
                  </td>
                ))}
                <td className="p-2 whitespace-nowrap">
                  {line.status === 'no_transfer_needed' ? '—' : (line.timing_reference_date ?? '—')}
                </td>
                <td className="p-2">{lineStatus(line.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
      <HelpDisclosure>
        <p>{t('method')}</p>
        <p>{t('noGuarantee')}</p>
      </HelpDisclosure>
      {report.source_calendar && (
        <CalendarEvidence
          title={dates('sourceCalendar')}
          calendar={report.source_calendar}
          search={report.dispatch}
        />
      )}
      {report.lines.map((line) => (
        <details key={line.location_id} className="workspace-panel min-w-0 space-y-3 wrap-anywhere">
          <summary className="cursor-pointer py-2 font-medium">
            {t('branchEvidence', { branch: line.location_code })}
          </summary>
          {line.timing_reference_date && line.status !== 'no_transfer_needed' && (
            <p>
              {dates('timingReference', {
                date: line.timing_reference_date,
                days: line.policy_reference?.lead_time ?? '—',
              })}
            </p>
          )}
          <p>
            {dates('savedLeads', {
              p50:
                report.source.lines.find((v) => v.location_id === line.location_id)?.evidence.lane
                  ?.lead_time_days_p50 ?? '—',
              p90:
                report.source.lines.find((v) => v.location_id === line.location_id)?.evidence.lane
                  ?.lead_time_days_p90 ?? '—',
            })}
          </p>
          {line.lane && (
            <p>
              {dates('laneSnapshot', {
                id: line.lane.id,
                p50: line.lane.lead_time_days_p50,
                p90: line.lane.lead_time_days_p90,
                time: line.lane.updated_at,
              })}
            </p>
          )}
          <p>
            {dates('locationSnapshot', {
              source: report.sender?.code ?? '—',
              sourceTime: report.sender?.updated_at ?? '—',
              destination: line.receiver?.code ?? '—',
              destinationTime: line.receiver?.updated_at ?? '—',
            })}
          </p>
          {line.policy_reference && (
            <p className="text-xs">{t('policyReference', { id: line.policy_reference.id })}</p>
          )}
          {(['p50', 'p90'] as const).map((key) => {
            const receipt = line.receipts[key]
            return receipt ? (
              <div key={key} className="space-y-2">
                <p>{dates('nominal', { date: receipt.nominal_date })}</p>
                <CalendarEvidence
                  title={dates(`${key}Calendar`)}
                  calendar={receipt.calendar}
                  search={receipt.search}
                />
              </div>
            ) : null
          })}
        </details>
      ))}
      <details className="workspace-panel min-w-0 space-y-3">
        <summary className="cursor-pointer py-2 font-medium">{t('quantityEvidence')}</summary>
        <NetworkAllocationReport report={report.source} locale={locale} />
      </details>
      <Link
        className="inline-block underline"
        prefetch={false}
        href={`/replenishment/network/${report.allocation_id}`}
      >
        {t('source')}
      </Link>
    </section>
  )
}
