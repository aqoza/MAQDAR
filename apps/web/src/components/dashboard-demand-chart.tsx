'use client'

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { DashboardData } from '@/lib/dashboard'

export function DashboardDemandChart({
  data,
  locale,
  sold,
  lost,
  label,
}: {
  data: DashboardData['demand']
  locale: string
  sold: string
  lost: string
  label: string
}) {
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 })
  const date = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' })
  // Only chart coordinates use Number; the database and the accessible data table retain decimals.
  const points = data.map((row) => ({
    date: row.date,
    sold: Number(row.quantity),
    lost: Number(row.lost_sales_quantity),
  }))
  return (
    <div className="h-72 min-w-0" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <LineChart data={points} accessibilityLayer>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(value: string) => date.format(new Date(`${value}T00:00:00Z`))}
            minTickGap={28}
          />
          <YAxis tickFormatter={(value: number) => number.format(value)} width={70} />
          <Tooltip formatter={(value) => number.format(Number(value))} />
          <Legend />
          <Line
            type="linear"
            dataKey="sold"
            name={sold}
            stroke="var(--chart-1)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="linear"
            dataKey="lost"
            name={lost}
            stroke="var(--chart-2)"
            strokeWidth={2}
            strokeDasharray="5 3"
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
