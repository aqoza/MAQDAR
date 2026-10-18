'use client'

import {
  Area,
  CartesianGrid,
  Legend,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useId } from 'react'
import type { DashboardData } from '@/lib/dashboard'

export function DashboardDemandChart({
  data,
  locale,
  sold,
  lost,
  label,
  units,
}: {
  data: DashboardData['demand']
  locale: string
  sold: string
  lost: string
  label: string
  units: string
}) {
  const gradientId = useId()
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 })
  const date = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' })
  // Only chart coordinates use Number; the database and the accessible data table retain decimals.
  const points = data.map((row) => ({
    date: row.date,
    sold: Number(row.quantity),
    lost: Number(row.lost_sales_quantity),
    soldExact: row.quantity,
    lostExact: row.lost_sales_quantity,
  }))
  return (
    <div className="dashboard-chart" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <ComposedChart
          data={points}
          accessibilityLayer
          margin={{ top: 15, bottom: 0, left: 0, right: 4 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#29b66a" stopOpacity={0.3} />
              <stop offset="1" stopColor="#29b66a" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#dce5ef" />
          <XAxis
            dataKey="date"
            ticks={points.filter((_, index) => index % 2 === 1).map((point) => point.date)}
            tickFormatter={(value: string) => date.format(new Date(`${value}T00:00:00Z`))}
            minTickGap={28}
            tick={{ fill: '#597299', fontSize: 12 }}
            tickLine={{ stroke: '#c9d5e4' }}
            axisLine={{ stroke: '#c9d5e4' }}
            tickMargin={8}
          />
          <YAxis
            tickCount={6}
            domain={[0, (maximum: number) => Math.max(1, Math.ceil((maximum * 1.2) / 20) * 20)]}
            tickFormatter={(value: number) => number.format(value)}
            width={58}
            tick={{ fill: '#49638a', fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: '#c9d5e4' }}
            label={{
              value: units,
              angle: -90,
              position: 'insideLeft',
              fill: '#345278',
              fontSize: 12,
            }}
          />
          <Tooltip
            formatter={(value, name, item) => {
              const point = item.payload as (typeof points)[number] | undefined
              const exact = item.dataKey === 'sold' ? point?.soldExact : point?.lostExact
              return [number.format((exact ?? value) as number), name]
            }}
            contentStyle={{
              border: '1px solid #d4dfe8',
              borderRadius: 6,
              fontSize: 'var(--text-xs)',
              lineHeight: 'var(--text-xs--line-height)',
              color: '#0e1b35',
              boxShadow: '0 3px 8px #163b4b12',
            }}
            labelStyle={{
              fontWeight: 600,
              fontSize: 'var(--text-sm)',
              lineHeight: 'var(--text-sm--line-height)',
            }}
          />
          <Legend
            itemSorter={() => 0}
            formatter={(value) => <span style={{ color: '#173051' }}>{value}</span>}
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12, paddingTop: 5 }}
          />
          <Area
            type="linear"
            dataKey="sold"
            name={sold}
            stroke="#009b4b"
            fill={`url(#${gradientId})`}
            strokeWidth={1.5}
            dot={{ r: 3, fill: '#009b4b', strokeWidth: 1 }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
          <Line
            type="linear"
            dataKey="lost"
            name={lost}
            stroke="#ff8000"
            strokeWidth={1.5}
            dot={{ r: 3, fill: '#ff8000', strokeWidth: 1 }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
