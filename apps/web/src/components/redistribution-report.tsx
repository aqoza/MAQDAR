import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { HelpDisclosure } from './help-disclosure'
import { TableScrollRegion } from './table-scroll-region'
import { ReplenishmentReport } from './replenishment-report'
import { DemandUnitEvidence } from './demand-unit-evidence'
import { formatScore } from '@/lib/forecast-quality'
import type { RedistributionReport as Report } from '@/lib/redistribution'

export async function RedistributionReport({ report, locale }: { report: Report; locale: string }) {
  const [t, stock] = await Promise.all([
    getTranslations('Redistribution'),
    getTranslations('StockComparison'),
  ])
  const source = report.source_policy
  const destination = report.destination
  const amount = (value: string | null | undefined) => formatScore(value, locale)
  const unit = destination.policy.unit ?? '—'
  const timingConcern = destination.orders.some((order) => order.overdue || order.late)
  return (
    <section className="space-y-4" aria-label={t('result')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-section-title">{t('result')}</h2>
        <p role="status">{t(`statuses.${report.status}`)}</p>
      </div>
      {report.status === 'source_unavailable' && source && (
        <p role="alert">{stock(`statuses.${source.status}`)}</p>
      )}
      {timingConcern && (
        <p
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950"
        >
          {t('timingWarning')}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ['gap', destination.gap],
            ['surplus', report.source_surplus],
            ['quantity', report.quantity],
          ] as const
        ).map(([key, value]) => (
          <div className="workspace-panel min-w-0" key={key}>
            <p className="text-muted-foreground">{t(key)}</p>
            <p className="text-metric wrap-anywhere tabular-nums">
              {amount(value)} {unit}
            </p>
          </div>
        ))}
      </div>
      <HelpDisclosure>
        <p>{t('formula')}</p>
        <p>{t('asOf')}</p>
        <p>{t('noReservation')}</p>
      </HelpDisclosure>
      {source && (
        <div className="space-y-3">
          <h3 className="text-section-title">{t('sourceEvidence')}</h3>
          <p>
            {report.source_location_code} · {source.item_code} · {source.cutoff} ·{' '}
            {source.basis === 'approved'
              ? t('approved', { revision: source.revision ?? 0 })
              : t('calculated')}
          </p>
          <TableScrollRegion label={t('sourceEvidence')}>
            <table className="w-full min-w-[36rem] text-sm">
              <caption className="sr-only">{t('sourceEvidence')}</caption>
              <thead>
                <tr>
                  {(['onHand', 'allocated', 'backorders', 'maximum', 'stockDate'] as const).map(
                    (key) => (
                      <th className="p-2 text-start" key={key}>
                        {t(key)}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                <tr className="border-t">
                  {[
                    source.snapshot?.quantity,
                    source.snapshot?.allocated,
                    report.backorders,
                    source.maximum,
                  ].map((value, index) => (
                    <td className="p-2 whitespace-nowrap tabular-nums" key={index}>
                      {amount(value)} {source.unit ?? '—'}
                    </td>
                  ))}
                  <td className="p-2 whitespace-nowrap">{source.snapshot?.date ?? '—'}</td>
                </tr>
              </tbody>
            </table>
          </TableScrollRegion>
          <details className="workspace-panel space-y-3 wrap-anywhere">
            <summary>{t('sourceDetails')}</summary>
            <DemandUnitEvidence evidence={source.unit_provenance} />
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt>{t('policyId')}</dt>
                <dd>{source.policy_id}</dd>
              </div>
              <div>
                <dt>{t('overrideId')}</dt>
                <dd>{source.override_id ?? '—'}</dd>
              </div>
              <div>
                <dt>{t('snapshotId')}</dt>
                <dd>{source.snapshot?.id ?? '—'}</dd>
              </div>
              <div>
                <dt>{t('updatedAt')}</dt>
                <dd>{source.snapshot?.updated_at ?? '—'}</dd>
              </div>
            </dl>
            <Link
              className="inline-block underline"
              href={`/forecasts/workbench/${source.policy_id}`}
            >
              {t('openSource')}
            </Link>
          </details>
        </div>
      )}
      <details className="workspace-panel space-y-3 wrap-anywhere">
        <summary>{t('destinationEvidence')}</summary>
        <ReplenishmentReport report={destination} locale={locale} />
        <Link className="inline-block underline" href={`/replenishment/${report.draft_id}`}>
          {t('openDestination')}
        </Link>
      </details>
      {report.lane && (
        <details className="workspace-panel space-y-3 wrap-anywhere">
          <summary>{t('laneEvidence')}</summary>
          <p>
            {report.source_location_code} → {destination.policy.location_code}
          </p>
          <p>
            {t('leadTimes', {
              p50: report.lane.lead_time_days_p50,
              p90: report.lane.lead_time_days_p90,
            })}
          </p>
          <p>{t('timingNotAssessed')}</p>
          <p>{t('laneSnapshot', { id: report.lane.id, time: report.lane.updated_at })}</p>
          <p>{t(report.lane.active ? 'activeLane' : 'inactiveLane')}</p>
          <p>
            {t('freightContext', {
              basis: t(`freightBases.${report.lane.freight_basis}`),
              cost: amount(report.lane.freight_cost),
              currency: report.lane.currency ?? '—',
            })}
          </p>
        </details>
      )}
    </section>
  )
}
