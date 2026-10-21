'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { driverCoverage, type DriverReport } from '@/lib/external-drivers'
import { TableScrollRegion } from './table-scroll-region'

export function ExternalDriverReport({ report }: { report: DriverReport }) {
  const t = useTranslations('ExternalDrivers')
  const [page, setPage] = useState(1)
  const pages = Math.ceil(report.daily.length / 50)
  return (
    <div className="min-w-0 space-y-4">
      <dl className="grid gap-3 workspace-panel sm:grid-cols-2 lg:grid-cols-4">
        {(['item_code', 'location_code', 'unit', 'source'] as const).map((key) => (
          <div key={key} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t(key)}</dt>
            <dd className="break-words text-evidence-value">
              <bdi>{report.input[key]}</bdi>
            </dd>
          </div>
        ))}
      </dl>
      <div className="grid min-w-0 gap-3 lg:grid-cols-2">
        {(['history', 'forecast'] as const).map((period) => (
          <section key={period} className="min-w-0 workspace-panel" aria-label={t(period)}>
            <h2 className="text-section-title">{t(period)}</h2>
            <p className="mt-1 text-xs" dir="ltr">
              {period === 'history'
                ? `${report.input.history_from} – ${report.input.cutoff}`
                : `${report.daily.find((d) => d.period === 'forecast')?.date} – ${report.input.forecast_to}`}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Object.entries(driverCoverage(report, period)).map(([key, count]) => (
                <div key={key}>
                  <dt className="text-xs text-muted-foreground">
                    {t(`counts.${key as keyof ReturnType<typeof driverCoverage>}`)}
                  </dt>
                  <dd className="text-evidence-value">{count}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <TableScrollRegion label={t('daily')}>
        <table className="w-full text-sm">
          <caption className="sr-only">{t('daily')}</caption>
          <thead>
            <tr>
              {(['date', 'period', 'value', 'kind', 'available_on', 'availability'] as const).map(
                (key) => (
                  <th key={key} className="p-2 text-start">
                    {t(key)}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {report.daily.slice((page - 1) * 50, page * 50).map((day) => (
              <tr key={day.date} className="border-t">
                <td className="whitespace-nowrap p-2">
                  <bdi>{day.date}</bdi>
                </td>
                <td className="p-2">{t(day.period)}</td>
                <td className="whitespace-nowrap p-2">
                  <bdi>{day.value ?? '—'}</bdi>
                </td>
                <td className="p-2">{day.kind ? t(`kinds.${day.kind}`) : '—'}</td>
                <td className="whitespace-nowrap p-2">
                  <bdi>{day.available_on ?? '—'}</bdi>
                </td>
                <td className="p-2">{t(`availabilityValues.${day.availability}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
      {pages > 1 && (
        <nav className="flex flex-wrap items-center gap-3" aria-label={t('daily')}>
          <button
            className="min-h-11 rounded-md border px-3 disabled:opacity-50"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            {t('previous')}
          </button>
          <span className="text-sm">{t('page', { page, pages })}</span>
          <button
            className="min-h-11 rounded-md border px-3 disabled:opacity-50"
            disabled={page === pages}
            onClick={() => setPage(page + 1)}
          >
            {t('next')}
          </button>
        </nav>
      )}
    </div>
  )
}
