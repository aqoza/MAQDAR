'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { InstalledDemandReport } from '@/lib/installed-base-demand'
import { TableScrollRegion } from './table-scroll-region'
import { InstalledBaseReport } from './installed-base-report'

export function InstalledBaseDemandReport({ report }: { report: InstalledDemandReport }) {
  const t = useTranslations('InstalledBaseDemand')
  const [page, setPage] = useState(1)
  const pages = Math.ceil(report.groups.length / 50)
  const population = report.source.population
  const summary = {
    item_code: population.input.item_code,
    location_code: population.input.location_code,
    unit: population.input.unit,
    cutoff: report.input.cutoff,
    horizon_days: report.input.horizon_days,
    daily_demand: report.daily_demand,
    total_demand: report.total_demand,
  }
  return (
    <div className="min-w-0 space-y-4">
      <section className="workspace-panel" aria-label={t('summary')}>
        <h2 className="text-subsection-title">{t('summary')}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t('conditional')}</p>
        <dl className="mt-3 grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3">
          {Object.entries(summary).map(([key, value]) => (
            <div key={key} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{t(key as keyof typeof summary)}</dt>
              <dd className="break-words text-evidence-value">
                <bdi>{value}</bdi>
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <TableScrollRegion label={t('groups')}>
        <table className="w-full min-w-[58rem] text-sm">
          <caption className="sr-only">{t('groups')}</caption>
          <thead>
            <tr>
              {(
                [
                  'group',
                  'installed_quantity',
                  'daily_rate',
                  'daily_demand',
                  'total_demand',
                  'rateEvidence',
                ] as const
              ).map((key) => (
                <th key={key} className="p-2 text-start text-xs font-medium">
                  {t(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.groups.slice((page - 1) * 50, page * 50).map((group) => (
              <tr key={group.group_code} className="border-t">
                <td className="max-w-72 break-words p-2">
                  <bdi>
                    {group.group_code} · {group.group_name}
                  </bdi>
                </td>
                <td className="whitespace-nowrap p-2">
                  <bdi>{group.installed_quantity}</bdi>
                </td>
                <td className="whitespace-nowrap p-2">
                  <bdi>{group.rate.daily_rate}</bdi>
                </td>
                <td className="whitespace-nowrap p-2">
                  <bdi>{group.daily_demand}</bdi>
                </td>
                <td className="whitespace-nowrap p-2">
                  <bdi>{group.total_demand}</bdi>
                </td>
                <td className="max-w-80 break-words p-2">
                  <bdi>{group.rate.source}</bdi>
                  <p className="mt-1 text-xs">
                    {t('available_on')}: <bdi>{group.rate.available_on}</bdi>
                  </p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
      {pages > 1 && (
        <nav aria-label={t('groups')} className="flex flex-wrap items-center gap-3">
          <button
            className="min-h-11 rounded-md border px-3 disabled:opacity-50"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {t('previous')}
          </button>
          <span className="text-sm">{t('page', { page, pages })}</span>
          <button
            className="min-h-11 rounded-md border px-3 disabled:opacity-50"
            disabled={page === pages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t('next')}
          </button>
        </nav>
      )}
      <details className="min-w-0 workspace-panel">
        <summary className="min-h-11 cursor-pointer md:min-h-0 text-subsection-title">
          {t('dailyLedger')}
        </summary>
        <TableScrollRegion label={t('dailyLedger')}>
          <table className="mt-3 w-full min-w-[24rem] text-sm">
            <thead>
              <tr>
                <th className="p-2 text-start text-xs font-medium">{t('date')}</th>
                <th className="p-2 text-start text-xs font-medium">{t('daily_demand')}</th>
              </tr>
            </thead>
            <tbody>
              {report.days.map((day) => (
                <tr key={day.date} className="border-t">
                  <td className="p-2">
                    <bdi>{day.date}</bdi>
                  </td>
                  <td className="p-2">
                    <bdi>{day.expected_demand}</bdi>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollRegion>
      </details>
      <details className="min-w-0 workspace-panel">
        <summary className="min-h-11 cursor-pointer md:min-h-0 text-subsection-title">
          {t('populationEvidence')}
        </summary>
        <p className="my-3 text-xs">
          {t('importedAt')}: <bdi>{report.source.population_imported_at}</bdi>
        </p>
        <InstalledBaseReport report={population} />
        <p className="mt-3 text-xs text-muted-foreground">{t('claims')}</p>
      </details>
    </div>
  )
}
