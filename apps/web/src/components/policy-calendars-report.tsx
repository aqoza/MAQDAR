import { getLocale, getTranslations } from 'next-intl/server'
import type { CalendarEvidence } from '@/lib/policy-calendars'
import { PolicySimulationLedger } from '@/components/policy-simulation-ledger'
import { PolicyCalendarsEvidence } from '@/components/policy-calendars-evidence'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { HelpDisclosure } from '@/components/help-disclosure'

export async function PolicyCalendarsReport({
  evidence,
  selected,
}: {
  evidence: CalendarEvidence
  selected?: string
}) {
  const [t, simulation, locale] = await Promise.all([
    getTranslations('PolicyCalendars'),
    getTranslations('PolicySimulation'),
    getLocale(),
  ])
  const format = new Intl.NumberFormat(locale, { maximumFractionDigits: 6 })
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 })
  const amount = (value: string | number | null) =>
    value === null ? '—' : format.format(value as number)
  const original = evidence.source_comparison.evidence.output.variants
  const rows = original.flatMap((variant, index) => {
    const saved = {
      variant,
      label: index === 0 ? t('baseline') : t('original', { number: index }),
      calendar: null as CalendarEvidence['output']['variants'][number] | null,
    }
    const replay = evidence.output.variants[index - 1]
    return index > 0 && replay
      ? [saved, { variant: replay, label: t('adjusted', { number: index }), calendar: replay }]
      : [saved]
  })
  const chosen =
    selected && /^\d{1,2}$/.test(selected) ? Math.min(Number(selected), rows.length - 1) : 0
  const row = rows[chosen]
  const shifted = row.calendar
  const metrics = [
    'average_closing_stock',
    'backlog_days',
    'ending_backlog',
    'immediate_fill_rate',
    'ordered_quantity',
    'ending_on_order',
  ] as const
  return (
    <div className="min-w-0 space-y-4">
      <HelpDisclosure>
        <p className="text-xs">{t('meaning')}</p>
        <p className="text-xs">{t('scheduling')}</p>
        <p className="text-xs">{t('captureMeaning')}</p>
      </HelpDisclosure>
      {evidence.output.failure && (
        <div role="status" className="workspace-panel space-y-2">
          <h2 className="text-section-title">{t(`statuses.${evidence.output.status}`)}</h2>
          <p>
            {t('failure', {
              number: evidence.output.failure.variant,
              stage: t(evidence.output.failure.stage),
              date: evidence.output.failure.checked_through ?? evidence.output.failure.nominal_date,
            })}
          </p>
        </div>
      )}
      <section className="workspace-panel min-w-0 space-y-3">
        <h2 className="text-section-title">{t('comparison')}</h2>
        <p>
          {evidence.policy.item_code} · {evidence.policy.unit} · {evidence.from_date} –{' '}
          {evidence.to_date}
        </p>
        <TableScrollRegion label={t('comparison')}>
          <table aria-label={t('comparison')} className="w-full min-w-[1100px] text-sm">
            <thead className="text-xs [&_th]:font-medium">
              <tr>
                <th className="p-2 text-start text-xs">{t('variant')}</th>
                {(['maximum', 'lead', 'review', 'moq', 'pack'] as const).map((key) => (
                  <th key={key} className="p-2 text-start text-xs">
                    {t(key)}
                  </th>
                ))}
                {metrics.map((key) => (
                  <th key={key} className="p-2 text-start text-xs">
                    {simulation(`metrics.${key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <tr key={entry.label} className="border-t">
                  <th className="p-2 text-start font-medium">{entry.label}</th>
                  {[
                    entry.variant.maximum,
                    entry.variant.lead_time,
                    entry.variant.review_interval,
                    entry.variant.moq,
                    entry.variant.pack,
                  ].map((value, index) => (
                    <td key={index} className="p-2 tabular-nums">
                      {amount(value)}
                    </td>
                  ))}
                  {metrics.map((key) => (
                    <td key={key} className="p-2 tabular-nums">
                      {key === 'immediate_fill_rate' && entry.variant.metrics[key] !== null
                        ? percent.format(entry.variant.metrics[key] as unknown as number)
                        : amount(entry.variant.metrics[key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollRegion>
      </section>
      <form className="workspace-panel flex flex-wrap items-end gap-3">
        <label className="grid min-w-0 gap-1">
          {t('ledger')}
          <select
            name="variant"
            defaultValue={chosen}
            className="min-h-11 w-full min-w-0 rounded-md border bg-background p-2"
          >
            {rows.map((entry, index) => (
              <option value={index} key={entry.label}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <button className="min-h-11 rounded-md border px-4 py-2">{t('show')}</button>
      </form>
      <section className="workspace-panel min-w-0 space-y-3">
        <h2 className="text-section-title">{row.label}</h2>
        <PolicySimulationLedger
          variant={row.variant}
          label={row.label}
          rounding={row.variant.moq !== null}
        />
        {shifted && (
          <>
            <h3 className="text-subsection-title">{t('reviewShifts')}</h3>
            <TableScrollRegion label={t('reviewShifts')}>
              <table aria-label={t('reviewShifts')} className="w-full min-w-[480px] text-sm">
                <thead className="text-xs [&_th]:font-medium">
                  <tr>
                    {(['nominalReview', 'actualReview', 'status'] as const).map((key) => (
                      <th key={key} className="p-2 text-start text-xs">
                        {t(key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shifted.review_schedule.map((entry) => (
                    <tr className="border-t" key={entry.nominal_date}>
                      <td className="p-2">{entry.nominal_date}</td>
                      <td className="p-2">{entry.date ?? '—'}</td>
                      <td className="p-2">{t(`statuses.${entry.status}`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScrollRegion>
            <h3 className="text-subsection-title">{t('receiptShifts')}</h3>
            <TableScrollRegion label={t('receiptShifts')}>
              <table aria-label={t('receiptShifts')} className="w-full min-w-[480px] text-sm">
                <thead className="text-xs [&_th]:font-medium">
                  <tr>
                    {(['actualReview', 'nominalReceipt', 'actualReceipt'] as const).map((key) => (
                      <th key={key} className="p-2 text-start text-xs">
                        {t(key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shifted.ledger
                    .filter((entry) => entry.order_due)
                    .map((entry) => (
                      <tr className="border-t" key={entry.date}>
                        <td className="p-2">{entry.date}</td>
                        <td className="p-2">{entry.nominal_receipt}</td>
                        <td className="p-2">{entry.order_due}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </TableScrollRegion>
          </>
        )}
      </section>
      <PolicyCalendarsEvidence evidence={evidence} />
    </div>
  )
}
