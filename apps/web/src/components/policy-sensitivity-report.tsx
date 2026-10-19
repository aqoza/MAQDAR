import { getLocale, getTranslations } from 'next-intl/server'
import { HelpDisclosure } from '@/components/help-disclosure'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { PolicySimulationLedger } from '@/components/policy-simulation-ledger'
import type { SensitivityEvidence } from '@/lib/policy-sensitivity'

export async function PolicySensitivityReport({
  evidence,
  selected,
}: {
  evidence: SensitivityEvidence
  selected: string | undefined
}) {
  const [t, simulation, locale] = await Promise.all([
    getTranslations('PolicySensitivity'),
    getTranslations('PolicySimulation'),
    getLocale(),
  ])
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 6 })
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 })
  const amount = (value: string | number | null) =>
    value === null ? simulation('unavailable') : number.format(value as number)
  const label = (index: number) =>
    index === 0 ? simulation('baseline') : t('alternative', { number: index })
  const variants = evidence.output.variants
  const chosen =
    selected && /^(0|[1-9]|10)$/.test(selected) && Number(selected) < variants.length
      ? Number(selected)
      : 0
  const variant = variants[chosen]
  const common = variants[0].metrics
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
        <p>{simulation('method')}</p>
        <p>{simulation('ratios')}</p>
        <p>
          {simulation('captured', {
            time: evidence.source_simulation.evidence.computed_at,
            recorded: evidence.demand.filter((day) => day.recorded).length,
            missing: evidence.demand.filter((day) => !day.recorded).length,
          })}
        </p>
      </HelpDisclosure>
      <p>
        {t('sharedDemand', {
          sold: amount(common.sold_quantity),
          lost: amount(common.lost_sales_quantity),
          unit: evidence.policy.unit,
        })}
      </p>
      <TableScrollRegion label={t('comparison')}>
        <table className="w-full min-w-[68rem] text-sm">
          <caption className="p-3 text-start text-section-title">{t('comparison')}</caption>
          <thead>
            <tr>
              <th className="p-3 text-start">{t('variant')}</th>
              <th className="p-3 text-start">{simulation('maximum')}</th>
              {(
                [
                  'average_closing_stock',
                  'immediate_fill_rate',
                  'backlog_days',
                  'ending_backlog',
                  'ending_stock',
                  'ending_on_order',
                  'ordered_quantity',
                  'order_count',
                ] as const
              ).map((key) => (
                <th key={key} className="p-3 text-start text-xs">
                  {simulation(`metrics.${key}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {variants.map((row, index) => (
              <tr key={row.name} className="border-t">
                <th className="p-3 text-start font-medium">{label(index)}</th>
                <td className="p-3 tabular-nums">{amount(row.maximum)}</td>
                {(
                  [
                    'average_closing_stock',
                    'immediate_fill_rate',
                    'backlog_days',
                    'ending_backlog',
                    'ending_stock',
                    'ending_on_order',
                    'ordered_quantity',
                    'order_count',
                  ] as const
                ).map((key) => (
                  <td key={key} className="p-3 tabular-nums">
                    {key === 'immediate_fill_rate' && row.metrics[key] !== null
                      ? percent.format(row.metrics[key] as unknown as number)
                      : amount(row.metrics[key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
      <section className="workspace-panel min-w-0 space-y-3">
        <h2 className="text-section-title">{t('inspectLedger')}</h2>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="grid min-w-0 gap-1">
            <label htmlFor="sensitivity-variant">{t('variant')}</label>
            <select
              id="sensitivity-variant"
              name="variant"
              defaultValue={String(chosen)}
              className="min-h-11 max-w-full rounded-md border bg-background p-2"
            >
              {variants.map((row, index) => (
                <option key={row.name} value={index}>
                  {label(index)} · {amount(row.maximum)} {evidence.policy.unit}
                </option>
              ))}
            </select>
          </div>
          <button className="min-h-11 rounded-md bg-primary px-4 py-2 text-primary-foreground">
            {t('showLedger')}
          </button>
        </form>
        <p>
          {simulation('metrics.received_quantity')}: {amount(variant.metrics.received_quantity)} ·{' '}
          {simulation('metrics.immediate_fulfilled')}: {amount(variant.metrics.immediate_fulfilled)}
        </p>
        <PolicySimulationLedger
          variant={variant}
          label={simulation('ledger', { variant: label(chosen) })}
        />
      </section>
    </div>
  )
}
