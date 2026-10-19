import { getLocale, getTranslations } from 'next-intl/server'
import { HelpDisclosure } from '@/components/help-disclosure'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { PolicySimulationLedger } from '@/components/policy-simulation-ledger'
import type { ConstraintsEvidence } from '@/lib/policy-constraints'
import type { ConfigurationsEvidence } from '@/lib/policy-configurations'
import type { SensitivityEvidence } from '@/lib/policy-sensitivity'

export async function PolicySensitivityReport({
  evidence,
  selected,
}: {
  evidence: SensitivityEvidence | ConfigurationsEvidence | ConstraintsEvidence
  selected: string | undefined
}) {
  const [t, simulation, locale] = await Promise.all([
    getTranslations(
      evidence.method === 'periodic-constraints-v1'
        ? 'PolicyConstraints'
        : evidence.method === 'periodic-configurations-v1'
          ? 'PolicyConfigurations'
          : 'PolicySensitivity',
    ),
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
  const configuration =
    evidence.method !== 'periodic-sensitivity-v1' ? evidence.output.variants[chosen] : null
  const constraint =
    evidence.method === 'periodic-constraints-v1' ? evidence.output.variants[chosen] : null
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
        {evidence.method === 'periodic-constraints-v1' && <p>{t('roundingHelp')}</p>}
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
              {evidence.method !== 'periodic-sensitivity-v1' && (
                <>
                  <th className="p-3 text-start">{t('lead')}</th>
                  <th className="p-3 text-start">{t('review')}</th>
                </>
              )}
              {evidence.method === 'periodic-constraints-v1' && (
                <>
                  <th className="p-3 text-start">{t('moq')}</th>
                  <th className="p-3 text-start">{t('pack')}</th>
                  <th className="p-3 text-start">{t('roundingTotal')}</th>
                </>
              )}
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
                {'lead_time' in row && (
                  <>
                    <td className="p-3 tabular-nums">{amount(row.lead_time)}</td>
                    <td className="p-3 tabular-nums">{amount(row.review_interval)}</td>
                  </>
                )}
                {'moq' in row && (
                  <>
                    <td className="p-3 tabular-nums">{row.moq === null ? '—' : amount(row.moq)}</td>
                    <td className="p-3 tabular-nums">
                      {row.pack === null ? '—' : amount(row.pack)}
                    </td>
                    <td className="p-3 tabular-nums">
                      {row.metrics.rounding_extra_quantity === undefined
                        ? '—'
                        : amount(row.metrics.rounding_extra_quantity)}
                    </td>
                  </>
                )}
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
          <div className="grid w-full min-w-0 max-w-full gap-1 sm:w-auto">
            <label htmlFor="sensitivity-variant">{t('variant')}</label>
            <select
              id="sensitivity-variant"
              name="variant"
              defaultValue={String(chosen)}
              className="min-h-11 w-full min-w-0 max-w-full rounded-md border bg-background p-2"
            >
              {variants.map((row, index) => (
                <option key={row.name} value={index}>
                  {label(index)} · {amount(row.maximum)} {evidence.policy.unit}
                  {'lead_time' in row
                    ? ` · ${t('settings', { lead: row.lead_time, review: row.review_interval })}`
                    : ''}
                </option>
              ))}
            </select>
          </div>
          <button className="min-h-11 rounded-md bg-primary px-4 py-2 text-primary-foreground">
            {t('showLedger')}
          </button>
        </form>
        {configuration && (
          <p>
            {t('settings', {
              lead: configuration.lead_time,
              review: configuration.review_interval,
            })}
          </p>
        )}
        {constraint && (
          <p>
            {constraint.moq === null
              ? t('unconstrained')
              : t('constraints', {
                  moq: amount(constraint.moq),
                  pack: amount(constraint.pack),
                  unit: evidence.policy.unit,
                })}
          </p>
        )}
        <p>
          {simulation('metrics.received_quantity')}: {amount(variant.metrics.received_quantity)} ·{' '}
          {simulation('metrics.immediate_fulfilled')}: {amount(variant.metrics.immediate_fulfilled)}
        </p>
        <PolicySimulationLedger
          variant={variant}
          rounding={evidence.method === 'periodic-constraints-v1' && chosen > 0}
          label={simulation('ledger', { variant: label(chosen) })}
        />
      </section>
    </div>
  )
}
