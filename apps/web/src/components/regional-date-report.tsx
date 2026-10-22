import Link from 'next/link'
import { NextIntlClientProvider } from 'next-intl'
import { getTranslations, getMessages } from 'next-intl/server'
import type { RegionalDateReport as Report } from '@/lib/regional-dates'
import { CalendarEvidence } from './calendar-evidence'
import { RegionalSourcingReport } from './regional-sourcing-report'
import { TableScrollRegion } from './table-scroll-region'
import { HelpDisclosure } from './help-disclosure'

export async function RegionalDateReport({ report }: { report: Report }) {
  const [t, dates, allocation, messages] = await Promise.all([
    getTranslations('RegionalDates'),
    getTranslations('RegionalDates.dateLabels'),
    getTranslations('RegionalSourcing'),
    getMessages(),
  ])
  const unit = report.source.destination.policy.unit ?? '—'
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
          <p className="text-muted-foreground">{dates('requested')}</p>
          <p className="text-evidence-value">
            <bdi>{report.requested_date}</bdi>
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">{t('fixedQuantity')}</p>
          <p className="text-evidence-value">
            <bdi>
              {report.source.allocated} {unit}
            </bdi>
          </p>
        </div>
      </div>
      {report.source.destination.orders.some((order) => order.overdue || order.late) && (
        <p
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950"
        >
          {dates('existingWarning')}
        </p>
      )}
      <TableScrollRegion label={t('sources')}>
        <table className="w-full min-w-[52rem] text-sm">
          <caption className="sr-only">{t('sources')}</caption>
          <thead>
            <tr>
              <th className="min-w-28 p-2 text-start text-xs font-medium whitespace-nowrap">
                {allocation('source')}
              </th>
              <th className="p-2 text-start text-xs font-medium">{allocation('quantity')}</th>
              <th className="p-2 text-start text-xs font-medium">{dates('dispatch')}</th>
              <th className="p-2 text-start text-xs font-medium">{dates('p50')}</th>
              <th className="p-2 text-start text-xs font-medium">{dates('p90')}</th>
              <th className="p-2 text-start text-xs font-medium">{t('reference')}</th>
              <th className="p-2 text-start text-xs font-medium">{allocation('status')}</th>
            </tr>
          </thead>
          <tbody>
            {report.lines.map((line) => (
              <tr key={line.location_id} className="border-t">
                <th className="min-w-28 p-2 text-start whitespace-nowrap">
                  <bdi>{line.location_code}</bdi>
                </th>
                <td className="min-w-28 p-2 whitespace-nowrap tabular-nums">
                  <bdi>
                    {line.quantity} {unit}
                  </bdi>
                </td>
                <td className="p-2 whitespace-nowrap">
                  <bdi>{line.dispatch?.date ?? '—'}</bdi>
                  {line.dispatch && line.dispatch.status !== 'resolved' && (
                    <p className="whitespace-normal">
                      {dates(`searchStatuses.${line.dispatch.status}`)}
                    </p>
                  )}
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
                  {line.status === 'no_transfer_needed'
                    ? '—'
                    : (report.timing_reference_date ?? '—')}
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
      {report.lines.map((line) => (
        <details
          key={line.location_id}
          className="workspace-panel min-w-0 p-3! wrap-anywhere open:space-y-3"
        >
          <summary className="min-h-11 cursor-pointer py-2 font-medium">
            {t('sourceEvidence', { source: line.location_code })}
          </summary>
          {report.timing_reference_date && line.status !== 'no_transfer_needed' && (
            <p>
              {dates('timingReference', {
                date: report.timing_reference_date,
                days: report.policy_reference?.lead_time ?? '—',
              })}
            </p>
          )}
          <p>
            {dates('savedLeads', {
              p50:
                report.source.lines.find((v) => v.location_id === line.location_id)?.lane
                  ?.lead_time_days_p50 ?? '—',
              p90:
                report.source.lines.find((v) => v.location_id === line.location_id)?.lane
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
              source: line.sender?.code ?? '—',
              sourceTime: line.sender?.updated_at ?? '—',
              destination: report.receiver?.code ?? '—',
              destinationTime: report.receiver?.updated_at ?? '—',
            })}
          </p>
          {report.policy_reference && (
            <p className="text-xs">{t('policyReference', { id: report.policy_reference.id })}</p>
          )}
          {line.source_calendar && (
            <CalendarEvidence
              namespace="RegionalDates.calendar"
              title={dates('sourceCalendar')}
              calendar={line.source_calendar}
              search={line.dispatch}
            />
          )}
          {(['p50', 'p90'] as const).map((key) => {
            const receipt = line.receipts[key]
            return receipt ? (
              <div key={key} className="space-y-2">
                <p>{dates('nominal', { date: receipt.nominal_date })}</p>
                <CalendarEvidence
                  namespace="RegionalDates.calendar"
                  title={dates(`${key}Calendar`)}
                  calendar={receipt.calendar}
                  search={receipt.search}
                />
              </div>
            ) : null
          })}
        </details>
      ))}
      <details className="workspace-panel min-w-0 p-3! open:space-y-3">
        <summary className="min-h-11 cursor-pointer py-2 font-medium">
          {t('quantityEvidence')}
        </summary>
        <NextIntlClientProvider
          messages={{
            RegionalSourcing: messages.RegionalSourcing,
            StockRegion: messages.StockRegion,
          }}
        >
          <RegionalSourcingReport report={report.source} />
        </NextIntlClientProvider>
      </details>
      <Link
        className="inline-block underline"
        prefetch={false}
        href={`/replenishment/regional-stock/sourcing/${report.sourcing_id}`}
      >
        {t('source')}
      </Link>
    </section>
  )
}
