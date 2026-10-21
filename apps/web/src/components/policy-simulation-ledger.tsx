import { getLocale, getTranslations } from 'next-intl/server'
import { TableScrollRegion } from '@/components/table-scroll-region'
import type { SimulationEvidence } from '@/lib/policy-simulation'

export async function PolicySimulationLedger({
  variant: v,
  label,
  rounding = false,
}: {
  variant: Omit<SimulationEvidence['output']['variants'][number], 'name' | 'ledger'> & {
    name: string
    ledger: (SimulationEvidence['output']['variants'][number]['ledger'][number] & {
      order_gap?: string
      rounding_extra?: string
    })[]
  }
  rounding?: boolean
  label: string
}) {
  const [t, locale] = await Promise.all([getTranslations('PolicySimulation'), getLocale()])
  const constraints = await getTranslations('PolicyConstraints')
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 6 })
  const amount = (value: string) => number.format(value as unknown as number)
  return (
    <TableScrollRegion label={label}>
      <table className="w-full whitespace-nowrap text-sm">
        <caption className="sr-only">{label}</caption>
        <thead className="text-xs [&_th]:font-medium">
          <tr>
            {(
              [
                'date',
                'review',
                'opening_stock',
                'receipts',
                'backlog_fulfilled',
                'order_quantity',
                'order_due',
                'demand',
                'lost_sales',
                'immediate_fulfilled',
                'new_backlog',
                'closing_stock',
                'closing_backlog',
                'closing_on_order',
              ] as const
            ).map((key) => (
              <th className="p-3 text-start text-xs" key={key}>
                {t(`columns.${key}`)}
              </th>
            ))}
            {rounding && (
              <>
                <th className="p-3 text-start text-xs">{constraints('order_gap')}</th>
                <th className="p-3 text-start text-xs">{constraints('rounding_extra')}</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {v.ledger.map((row) => (
            <tr key={row.date} className="border-t">
              <th className="p-3 text-start font-medium">{row.date}</th>
              <td className="p-3">{t(row.review ? 'yes' : 'no')}</td>
              {(['opening_stock', 'receipts', 'backlog_fulfilled', 'order_quantity'] as const).map(
                (key) => (
                  <td className="p-3 tabular-nums" key={key}>
                    {amount(row[key])}
                  </td>
                ),
              )}
              <td className="p-3">{row.order_due ?? '—'}</td>
              {(
                [
                  'demand',
                  'lost_sales',
                  'immediate_fulfilled',
                  'new_backlog',
                  'closing_stock',
                  'closing_backlog',
                  'closing_on_order',
                ] as const
              ).map((key) => (
                <td className="p-3 tabular-nums" key={key}>
                  {amount(row[key])}
                </td>
              ))}
              {rounding && (
                <>
                  <td className="p-3 tabular-nums">
                    {row.order_gap === undefined ? '—' : amount(row.order_gap)}
                  </td>
                  <td className="p-3 tabular-nums">
                    {row.rounding_extra === undefined ? '—' : amount(row.rounding_extra)}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScrollRegion>
  )
}
