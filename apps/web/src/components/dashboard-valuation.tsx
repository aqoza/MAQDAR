'use client'

import { useState } from 'react'
import { formatInventoryValue, type DashboardData } from '@/lib/dashboard'

export function DashboardValuation({
  values,
  locale,
  label,
  allLabel,
  unavailable,
}: {
  values: DashboardData['inventory_value']
  locale: string
  label: string
  allLabel: string
  unavailable: string
}) {
  const [selected, setSelected] = useState(values[0]?.currency ?? '')
  const row = values.find((value) => value.currency === selected) ?? values[0]
  const exact = row ? formatInventoryValue(row.value, row.currency, locale) : unavailable
  const amount =
    row && exact.length > 12
      ? new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: row.currency,
          notation: 'compact',
          maximumFractionDigits: 2,
        }).format(row.value as unknown as number)
      : exact
  return (
    <div className="dashboard-valuation">
      {row ? (
        <details className="dashboard-currencies">
          <summary aria-label={`${amount} ${row.currency} — ${allLabel}`} title={exact}>
            <span className="dashboard-metric-value">{amount}</span>
            <span className="dashboard-currency-code">{row.currency}</span>
          </summary>
          <div className="dashboard-currency-popover">
            <label>
              {label}
              <select value={row?.currency} onChange={(event) => setSelected(event.target.value)}>
                {values.map((value) => (
                  <option key={value.currency}>{value.currency}</option>
                ))}
              </select>
            </label>
            <ul>
              {values.map((value) => (
                <li key={value.currency}>
                  <b>{value.currency}</b>{' '}
                  {formatInventoryValue(value.value, value.currency, locale)}
                </li>
              ))}
            </ul>
          </div>
        </details>
      ) : (
        <p className="dashboard-metric-value" data-unavailable="">
          {unavailable}
        </p>
      )}
    </div>
  )
}
