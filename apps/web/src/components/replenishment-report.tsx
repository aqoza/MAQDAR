import { HelpDisclosure } from '@/components/help-disclosure'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { DemandUnitEvidence } from './demand-unit-evidence'
import { TableScrollRegion } from './table-scroll-region'
import { formatScore } from '@/lib/forecast-quality'
import type { ReplenishmentReport as Report } from '@/lib/replenishment'

export async function ReplenishmentReport({ report, locale }: { report: Report; locale: string }) {
  const t = await getTranslations('Replenishment')
  const amount = (v: string | null | undefined) => formatScore(v, locale)
  const p = report.policy
  const stock = p.snapshot
  return (
    <section className="space-y-4" aria-label={t('result')}>
      <h2 className="text-section-title">{t('result')}</h2>
      <p role="status">{t(`statuses.${report.status}`)}</p>
      <p>
        {p.item_code} · {p.location_code} · {t('cutoff', { date: p.cutoff })}
      </p>
      <p>
        {p.basis === 'approved' ? t('approved', { revision: p.revision! }) : t('calculated')} ·{' '}
        {amount(p.maximum)} {p.unit ?? '—'}
      </p>
      <HelpDisclosure>
        <p>{t('formula')}</p>
      </HelpDisclosure>
      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ['available', stock?.available],
            ['inbound', report.inbound_quantity],
            ['backorders', report.backorders],
            ['position', report.inventory_position],
            ['maximum', p.maximum],
            ['gap', report.gap],
          ] as const
        ).map(([key, value]) => (
          <div className="workspace-panel" key={key}>
            <p className="text-sm text-muted-foreground">{t(key)}</p>
            <p className="text-evidence-value wrap-anywhere tabular-nums">
              {amount(value)} {(key === 'available' ? stock?.unit : p.unit) ?? '—'}
            </p>
          </div>
        ))}
      </div>
      <p>{t(report.orders_confirmed ? 'confirmed' : 'unconfirmed')}</p>
      <p className="text-sm text-muted-foreground">
        {t('timingNote', { date: report.protection_end ?? '—' })}
      </p>
      {stock && (
        <p>
          {t('stock', {
            date: stock.date,
            quantity: amount(stock.quantity),
            allocated: amount(stock.allocated),
            unit: stock.unit ?? '—',
          })}
        </p>
      )}
      <DemandUnitEvidence evidence={p.unit_provenance} />
      {report.orders_truncated && <p role="alert">{t('truncated')}</p>}
      {report.status !== 'prepared_group' && (
        <TableScrollRegion label={t('orders')}>
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="text-start font-semibold">{t('orders')}</caption>
            <thead>
              <tr>
                {(['order', 'supplier', 'expected', 'remaining', 'timing'] as const).map((key) => (
                  <th key={key} className="p-2 text-start">
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.orders.map((o) => (
                <tr key={o.id} className="border-t">
                  <td className="p-2">
                    {o.order_code} / {o.line_code}
                    <details>
                      <summary>{t('identity')}</summary>
                      <p>{o.id}</p>
                      <p>{o.updated_at}</p>
                    </details>
                  </td>
                  <td className="p-2">{o.supplier_code ?? '—'}</td>
                  <td className="p-2">{o.expected_date}</td>
                  <td className="p-2 tabular-nums">
                    {amount(o.quantity)} {o.unit ?? '—'}
                  </td>
                  <td className="p-2">
                    {t(
                      o.overdue
                        ? 'overdue'
                        : o.late === null
                          ? 'timingUnknown'
                          : o.late
                            ? 'late'
                            : 'within',
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollRegion>
      )}
      {report.status !== 'prepared_group' && !report.orders.length && !report.orders_truncated && (
        <p>{t('noOrders')}</p>
      )}
      <details>
        <summary>{t('identity')}</summary>
        <p>{t('policyId', { id: p.policy_id })}</p>
        {p.override_id && <p>{t('overrideId', { id: p.override_id })}</p>}
        {stock && <p>{t('stockId', { id: stock.id, time: stock.updated_at })}</p>}
      </details>
      <Link href={`/forecasts/workbench/${p.policy_id}`} className="inline-block underline">
        {t('policyEvidence')}
      </Link>
    </section>
  )
}
