import { getLocale, getTranslations } from 'next-intl/server'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { HelpDisclosure } from '@/components/help-disclosure'
import { PolicySimulationLedger } from '@/components/policy-simulation-ledger'
import type { SimulationEvidence } from '@/lib/policy-simulation'

export async function PolicySimulationReport({ evidence }: { evidence: SimulationEvidence }) {
  const [t, locale] = await Promise.all([getTranslations('PolicySimulation'), getLocale()])
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 6 })
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 })
  const amount = (value: string | number | null) =>
    value === null ? t('unavailable') : number.format(value as number)
  return (
    <div className="min-w-0 space-y-4">
      <p>
        {t('startingState', {
          stock: amount(evidence.options.opening_stock),
          unit: evidence.policy.unit,
        })}
      </p>
      <HelpDisclosure>
        <p>{t('interpretation')}</p>
        <p>{t('method')}</p>
        <p>{t('ratios')}</p>
        <p>
          {t('captured', {
            time: evidence.computed_at,
            recorded: evidence.demand.filter((day) => day.recorded).length,
            missing: evidence.demand.filter((day) => !day.recorded).length,
          })}
        </p>
      </HelpDisclosure>
      <TableScrollRegion label={t('comparison')}>
        <table className="w-full min-w-[32rem] text-sm">
          <caption className="p-3 text-start text-section-title">{t('comparison')}</caption>
          <thead>
            <tr>
              <th className="p-3 text-start">{t('metric')}</th>
              {evidence.output.variants.map((v) => (
                <th key={v.name} className="p-3 text-start">
                  {t(v.name)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t">
              <th className="p-3 text-start font-medium">{t('maximum')}</th>
              {evidence.output.variants.map((v) => (
                <td className="p-3 tabular-nums" key={v.name}>
                  {amount(v.maximum)}
                </td>
              ))}
            </tr>
            {(
              [
                'average_closing_stock',
                'backlog_days',
                'ending_backlog',
                'ending_stock',
                'ending_on_order',
                'immediate_fill_rate',
                'sold_quantity',
                'immediate_fulfilled',
                'lost_sales_quantity',
                'ordered_quantity',
                'received_quantity',
                'order_count',
              ] as const
            ).map((key) => (
              <tr className="border-t" key={key}>
                <th className="p-3 text-start font-medium">{t(`metrics.${key}`)}</th>
                {evidence.output.variants.map((v) => (
                  <td className="p-3 tabular-nums" key={v.name}>
                    {key === 'immediate_fill_rate' && v.metrics[key] !== null
                      ? percent.format(v.metrics[key] as unknown as number)
                      : amount(v.metrics[key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
      {evidence.output.variants.map((v) => (
        <details className="workspace-panel min-w-0" key={v.name}>
          <summary className="min-h-11 cursor-pointer text-subsection-title">
            {t('ledger', { variant: t(v.name) })}
          </summary>
          <PolicySimulationLedger variant={v} label={t('ledger', { variant: t(v.name) })} />
        </details>
      ))}
    </div>
  )
}
