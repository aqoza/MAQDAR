'use client'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import type { RegionalSourcingReport as Report } from '@/lib/regional-sourcing'
import { TableScrollRegion } from './table-scroll-region'
import { StockRegionReport } from './stock-region-report'

export function RegionalSourcingReport({ report }: { report: Report }) {
  const t = useTranslations('RegionalSourcing'),
    r = useTranslations('Redistribution'),
    stock = useTranslations('StockComparison'),
    locale = useLocale()
  const unit = report.destination.policy.unit ?? '—'
  const quantity = (v: string | null | undefined) => (
    <bdi>
      {v ?? '—'} {v == null ? '' : unit}
    </bdi>
  )
  const destination = report.destination
  return (
    <section className="min-w-0 space-y-4" aria-label={t('result')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-section-title">{t('result')}</h2>
        <p role="status">{t(report.status)}</p>
      </div>
      <p className="text-sm">
        <bdi>
          {destination.policy.item_code} · {destination.policy.location_code} ·{' '}
          {destination.policy.cutoff} · {unit}
        </bdi>
      </p>
      {destination.orders.some((o) => o.overdue || o.late) && (
        <p
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
        >
          {r('timingWarning')}
        </p>
      )}
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(
          [
            ['gap', destination.gap],
            ['totalSurplus', report.total_surplus],
            ['allocated', report.allocated],
            ['remainingGap', report.remaining_gap],
          ] as const
        ).map(([key, value]) => (
          <div className="min-w-0 workspace-panel" key={key}>
            <p className="text-xs text-muted-foreground">{t(key)}</p>
            <p className="text-evidence-value wrap-anywhere">{quantity(value)}</p>
          </div>
        ))}
      </div>
      <TableScrollRegion label={t('sources')}>
        <table className="w-full min-w-[56rem] text-sm">
          <thead>
            <tr>
              {(
                ['source', 'status', 'surplus', 'quantity', 'remainingSurplus', 'retained'] as const
              ).map((k) => (
                <th key={k} className="p-3 text-start text-xs font-medium">
                  {t(k)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.lines.map((line) => (
              <tr className="border-t" key={line.location_id}>
                <th className="max-w-64 break-words p-3 text-start">
                  <bdi>{line.location_code}</bdi>
                </th>
                <td className="max-w-72 p-3">
                  {r(`statuses.${line.status}`)}
                  {line.status === 'source_unavailable' && line.source_policy && (
                    <p>{stock(`statuses.${line.source_policy.status}`)}</p>
                  )}
                </td>
                {[line.surplus, line.quantity, line.remaining_surplus, line.retained_available].map(
                  (v, index) => (
                    <td key={index} className="p-3 whitespace-nowrap tabular-nums">
                      {quantity(v)}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
      <p className="text-sm text-muted-foreground">{t('retainedHelp')}</p>
      {report.lines.map((line) => {
        const policy = line.source_policy
        const location = report.locations.find((l) => l.id === line.location_id)
        return (
          <details
            key={line.location_id}
            className="min-w-0 space-y-3 workspace-panel wrap-anywhere"
          >
            <summary className="min-h-11 cursor-pointer py-3 text-sm">
              {t('sourceEvidence')} · <bdi>{line.location_code}</bdi>
            </summary>
            {policy && (
              <>
                <p className="text-sm">
                  {policy.basis === 'approved'
                    ? t('approved', { revision: policy.revision ?? 0 })
                    : t('calculated')}{' '}
                  · {policy.cutoff}
                </p>
                <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  {(
                    [
                      ['onHand', policy.snapshot?.quantity],
                      ['allocations', policy.snapshot?.allocated],
                      ['backorders', line.backorders],
                      ['maximum', policy.maximum],
                    ] as const
                  ).map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-xs text-muted-foreground">{t(key)}</dt>
                      <dd>{quantity(value)}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-xs">
                  {t('snapshot')}:{' '}
                  <bdi>
                    {policy.snapshot?.date ?? '—'} · {policy.snapshot?.unit ?? '—'} ·{' '}
                    {policy.snapshot?.id ?? '—'} · {policy.snapshot?.updated_at ?? '—'}
                  </bdi>
                </p>
                <p className="text-xs">
                  {t('policy')}: <bdi>{policy.policy_id}</bdi> · {t('override')}:{' '}
                  <bdi>{policy.override_id ?? '—'}</bdi>
                </p>
                <p className="text-xs">
                  {t('unitEvidence')}:{' '}
                  <bdi>
                    {policy.unit_provenance?.unit ?? '—'} · {policy.unit_provenance?.rows ?? 0}
                  </bdi>
                </p>
                <Link
                  className="inline-flex min-h-11 items-center text-sm underline"
                  href={`/forecasts/workbench/${policy.policy_id}`}
                >
                  {t('openPolicy')}
                </Link>
              </>
            )}
            {line.lane && (
              <div className="space-y-2 text-sm">
                <p>
                  {r('leadTimes', {
                    p50: line.lane.lead_time_days_p50,
                    p90: line.lane.lead_time_days_p90,
                  })}
                </p>
                <p>{r('timingNotAssessed')}</p>
                <p className="text-xs">
                  <bdi>
                    {line.lane.id} · {line.lane.updated_at}
                  </bdi>
                </p>
              </div>
            )}
            <p className="text-xs">
              {t('capturedLocation')}:{' '}
              {locale.startsWith('ar') && location?.name_ar ? location.name_ar : location?.name_en}{' '}
              ·{' '}
              <bdi>
                {line.location_id} · {location?.updated_at}
              </bdi>
            </p>
          </details>
        )
      })}
      <details className="min-w-0 space-y-3 workspace-panel wrap-anywhere">
        <summary className="min-h-11 cursor-pointer py-3 text-sm">
          {t('destinationEvidence')}
        </summary>
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ['onHand', destination.policy.snapshot?.quantity],
              ['allocations', destination.policy.snapshot?.allocated],
              ['maximum', destination.policy.maximum],
              ['backorders', destination.backorders],
              ['inbound', destination.inbound_quantity],
              ['position', destination.inventory_position],
            ] as const
          ).map(([key, value]) => (
            <div key={key}>
              <dt className="text-xs text-muted-foreground">{t(key)}</dt>
              <dd>{quantity(value)}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs">
          {t('snapshot')}:{' '}
          <bdi>
            {destination.policy.snapshot?.date} · {destination.policy.snapshot?.unit} ·{' '}
            {destination.policy.snapshot?.id} · {destination.policy.snapshot?.updated_at}
          </bdi>
        </p>
        <p className="text-xs">
          {t('policy')}: <bdi>{destination.policy.policy_id}</bdi> · {t('override')}:{' '}
          <bdi>{destination.policy.override_id ?? '—'}</bdi>
        </p>
        <p className="text-sm">{t('capturedInbound')}</p>
        <TableScrollRegion label={t('inbound')}>
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr>
                {(['order', 'quantity', 'expected', 'warnings'] as const).map((k) => (
                  <th key={k} className="p-2 text-start text-xs font-medium">
                    {t(k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {destination.orders.map((o) => (
                <tr key={o.id} className="border-t">
                  <td className="p-2">
                    <bdi>
                      {o.order_code} · {o.line_code}
                    </bdi>
                    <p className="text-xs">
                      <bdi>
                        {o.supplier_code} · {o.id} · {o.updated_at}
                      </bdi>
                    </p>
                  </td>
                  <td className="p-2 whitespace-nowrap">{quantity(o.quantity)}</td>
                  <td className="p-2 whitespace-nowrap">{o.expected_date}</td>
                  <td className="p-2">
                    {o.overdue ? t('overdue') : ''} {o.late ? t('late') : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollRegion>
        <Link
          className="inline-flex min-h-11 items-center text-sm underline"
          href={`/replenishment/${report.input.draft_id}`}
        >
          {t('openDraft')}
        </Link>
      </details>
      <details className="min-w-0 space-y-3 workspace-panel">
        <summary className="min-h-11 cursor-pointer py-3 text-sm">{t('regionEvidence')}</summary>
        <StockRegionReport report={report.region.definition} />
        <p className="break-all text-xs">
          <bdi>
            {report.region.id} · {report.region.created_at}
          </bdi>
        </p>
      </details>
      <details className="min-w-0 space-y-3 workspace-panel">
        <summary className="min-h-11 cursor-pointer py-3 text-sm">{t('methodDetails')}</summary>
        <p className="text-sm">{t('method')}</p>
        <p className="text-sm">{t('limits')}</p>
        <p className="text-sm">{t('commitments')}</p>
        <p className="text-sm">{t('lanes')}</p>
        <p className="break-all text-xs">
          {t('fingerprint')}: <bdi>{report.fingerprint}</bdi>
        </p>
      </details>
    </section>
  )
}
