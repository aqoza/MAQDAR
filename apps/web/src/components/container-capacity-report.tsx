import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { HelpDisclosure } from './help-disclosure'
import { TableScrollRegion } from './table-scroll-region'
import type { CapacityReport } from '@/lib/container-capacity'
import { formatCostDecimal } from '@/lib/purchase-costs'

export async function ContainerCapacityReport({ report }: { report: CapacityReport }) {
  const [t, locale, format] = await Promise.all([
    getTranslations('ContainerCapacity'),
    getLocale(),
    getFormatter(),
  ])
  const number = (value: string | null, digits = 9) => formatCostDecimal(value, locale, digits)
  const date = (value: string | null) =>
    value ? format.dateTime(new Date(value), { dateStyle: 'medium', timeZone: 'UTC' }) : '—'
  const totals = report.totals
  return (
    <section className="space-y-4">
      <p>
        <bdi>{report.summary.supplier_code}</bdi> · <bdi>{report.summary.location_code}</bdi> ·{' '}
        <bdi>{date(report.summary.order_date)}</bdi>
      </p>
      <p role={totals ? 'status' : 'alert'} className={totals?.within_limits ? 'text-primary' : ''}>
        {t(totals ? (totals.within_limits ? 'within' : 'over') : 'unavailable')}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {(['weight', 'volume'] as const).map((kind) => (
          <div key={kind} className="space-y-1 workspace-panel">
            <h2 className="text-subsection-title">
              {t(kind === 'weight' ? 'weightTotal' : 'volumeTotal')}
            </h2>
            <p className="text-section-title tabular-nums">
              <bdi>
                {t(kind === 'weight' ? 'weightValue' : 'volumeValue', {
                  value: number(
                    totals ? (kind === 'weight' ? totals.weight_kg : totals.volume_m3) : null,
                  ),
                })}
              </bdi>
            </p>
            <p>
              {t(kind === 'weight' ? 'payload' : 'volume')}:{' '}
              {number(kind === 'weight' ? report.payload_limit_kg : report.volume_limit_m3)}
            </p>
            {totals && (
              <>
                <p>
                  {t('utilization', {
                    value: number(
                      kind === 'weight'
                        ? totals.weight_utilization_pct
                        : totals.volume_utilization_pct,
                      2,
                    ),
                  })}
                </p>
                <p>
                  {t('overage', {
                    value: t(kind === 'weight' ? 'weightValue' : 'volumeValue', {
                      value: number(
                        kind === 'weight' ? totals.weight_over_kg : totals.volume_over_m3,
                      ),
                    }),
                  })}
                </p>
              </>
            )}
          </div>
        ))}
      </div>
      <TableScrollRegion label={t('lines')}>
        <table className="w-full text-start text-sm">
          <thead>
            <tr>
              {(['item', 'quantity', 'weight', 'cube', 'evidence'] as const).map((key) => (
                <th key={key} className="p-3 text-start text-xs font-medium">
                  {t(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.lines.map((line) => (
              <tr key={line.handoff_id} className="border-t align-top">
                <td className="p-3">
                  <Link className="underline" href={`/replenishment/handoffs/${line.handoff_id}`}>
                    {line.item_code}
                  </Link>
                </td>
                <td className="whitespace-nowrap p-3 tabular-nums">
                  <bdi>
                    {number(line.quantity)} {line.unit ?? '—'}
                  </bdi>
                </td>
                <td className="whitespace-nowrap p-3 tabular-nums">{number(line.weight_kg)}</td>
                <td className="whitespace-nowrap p-3 tabular-nums">{number(line.volume_m3)}</td>
                <td className="min-w-64 max-w-96 p-3">
                  <p>{t(`statuses.${line.status}`)}</p>
                  <details className="mt-2">
                    <summary className="cursor-pointer underline">{t('evidence')}</summary>
                    <div className="mt-2 space-y-1 break-words">
                      <p>{t('orderDate', { date: date(line.order_date) })}</p>
                      <p>{t('receiptDate', { date: date(line.receipt_date) })}</p>
                      {line.measurement && (
                        <>
                          <p>
                            {t('measurement', {
                              weight: number(line.measurement.weight_kg),
                              volume: number(line.measurement.volume_m3),
                              unit: line.measurement.unit ?? '—',
                            })}
                          </p>
                          <p>{t('effective', { date: date(line.measurement.valid_from) })}</p>
                          <p>
                            {t('updated', {
                              time: format.dateTime(new Date(line.measurement.updated_at), 'long'),
                            })}
                          </p>
                          <p className="break-all text-xs">{line.measurement.id}</p>
                        </>
                      )}
                    </div>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
      <HelpDisclosure>
        <p>{t('method')}</p>
        <p>{t('limitsNote')}</p>
        <p>{t('precisionNote')}</p>
      </HelpDisclosure>
    </section>
  )
}
