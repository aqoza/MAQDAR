import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import type { TransferDateReport as Report } from '@/lib/transfer-dates'
import { formatScore } from '@/lib/forecast-quality'
import { HelpDisclosure } from './help-disclosure'
import { CalendarEvidence } from './calendar-evidence'
import { RedistributionReport } from './redistribution-report'

export async function TransferDateReport({ report, locale }: { report: Report; locale: string }) {
  const t = await getTranslations('TransferDates')
  const timingConcern = report.source.destination.orders.some(
    (order) => order.overdue || order.late,
  )
  return (
    <section className="min-w-0 space-y-4" aria-label={t('result')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-section-title">{t('result')}</h2>
        <p role="status">{t(`statuses.${report.status}`)}</p>
      </div>
      <p>
        {t('savedQuantity', {
          quantity: formatScore(report.source.quantity, locale),
          unit: report.source.destination.policy.unit ?? '—',
        })}
      </p>
      {timingConcern && (
        <p
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950"
        >
          {t('existingWarning')}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="workspace-panel min-w-0">
          <h3 className="text-sm text-muted-foreground">{t('dispatch')}</h3>
          <p className="text-section-title tabular-nums">{report.dispatch?.date ?? '—'}</p>
          <p>{t('requestedOn', { date: report.requested_date })}</p>
          {report.dispatch && <p>{t(`searchStatuses.${report.dispatch.status}`)}</p>}
        </div>
        {(['p50', 'p90'] as const).map((key) => {
          const receipt = report.receipts[key]
          return (
            <div className="workspace-panel min-w-0 space-y-1" key={key}>
              <h3 className="text-sm text-muted-foreground">{t(key)}</h3>
              <p className="text-section-title tabular-nums">{receipt?.search.date ?? '—'}</p>
              <p>
                {t('leadDays', {
                  days:
                    report.source.lane?.[
                      key === 'p50' ? 'lead_time_days_p50' : 'lead_time_days_p90'
                    ] ?? '—',
                })}
              </p>
              {receipt && (
                <>
                  <p>{t('nominal', { date: receipt.nominal_date })}</p>
                  <p>{t(`searchStatuses.${receipt.search.status}`)}</p>
                  {receipt.timing_review_required && (
                    <p role="alert" className="font-medium text-amber-900">
                      {t('timingWarning', { scenario: t(key) })}
                    </p>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
      {report.timing_reference_date && (
        <p className="text-sm text-muted-foreground">
          {t('timingReference', {
            date: report.timing_reference_date,
            days: report.destination_lead_time ?? '—',
          })}
        </p>
      )}
      <HelpDisclosure>
        <p>{t('method')}</p>
        <p>{t('noGuarantee')}</p>
        <p>{t(report.calendars_confirmed ? 'confirmed' : 'unconfirmed')}</p>
      </HelpDisclosure>
      {report.source_calendar && (
        <CalendarEvidence
          title={t('sourceCalendar')}
          calendar={report.source_calendar}
          search={report.dispatch}
        />
      )}
      {(['p50', 'p90'] as const).map((key) => {
        const receipt = report.receipts[key]
        return receipt ? (
          <CalendarEvidence
            key={key}
            title={t(`${key}Calendar`)}
            calendar={receipt.calendar}
            search={receipt.search}
          />
        ) : null
      })}
      <details className="workspace-panel space-y-3 wrap-anywhere">
        <summary>{t('laneEvidence')}</summary>
        <p>
          {t('savedLeads', {
            p50: report.source.lane?.lead_time_days_p50 ?? '—',
            p90: report.source.lane?.lead_time_days_p90 ?? '—',
          })}
        </p>
        {report.lane && (
          <p>
            {t('laneSnapshot', {
              id: report.lane.id,
              p50: report.lane.lead_time_days_p50,
              p90: report.lane.lead_time_days_p90,
              time: report.lane.updated_at,
            })}
          </p>
        )}
        <p>
          {t('locationSnapshot', {
            source: report.sender?.code ?? '—',
            sourceTime: report.sender?.updated_at ?? '—',
            destination: report.receiver?.code ?? '—',
            destinationTime: report.receiver?.updated_at ?? '—',
          })}
        </p>
      </details>
      <details className="workspace-panel min-w-0 space-y-3 wrap-anywhere">
        <summary>{t('quantityEvidence')}</summary>
        <RedistributionReport report={report.source} locale={locale} />
      </details>
      <Link
        className="inline-block underline"
        href={`/replenishment/redistribution/${report.redistribution_id}`}
      >
        {t('source')}
      </Link>
    </section>
  )
}
