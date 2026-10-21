'use client'

import { useTranslations } from 'next-intl'
import type { InstalledEvaluationReport } from '@/lib/installed-base-evaluation'
import { TableScrollRegion } from './table-scroll-region'
import { InstalledBaseDemandReport } from './installed-base-demand-report'

export function InstalledBaseEvaluationReport({ report }: { report: InstalledEvaluationReport }) {
  const t = useTranslations('InstalledBaseEvaluation')
  const population = report.source.scenario.source.population
  const summary = {
    item_code: population.input.item_code,
    location_code: population.input.location_code,
    unit: report.unit,
    start_date: report.start_date,
    end_date: report.end_date,
    expected: report.totals.expected,
    sold: report.totals.sold,
    lost_sales: report.totals.lost_sales,
    difference: report.totals.difference,
    ...report.metrics,
    recorded_days: report.recorded_days,
    zero_filled_days: report.zero_filled_days,
  }
  return (
    <div className="min-w-0 space-y-4">
      <section className="workspace-panel" aria-label={t('summary')}>
        <h2 className="text-section-title">{t('summary')}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t('retrospective')}</p>
        <dl className="mt-3 grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3">
          {Object.entries(summary).map(([key, value]) => (
            <div key={key} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{t(key as keyof typeof summary)}</dt>
              <dd className="break-all text-evidence-value">
                <bdi>{value}</bdi>
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <TableScrollRegion label={t('ledger')}>
        <table className="w-full min-w-[60rem] text-sm">
          <caption className="sr-only">{t('ledger')}</caption>
          <thead>
            <tr>
              {(
                [
                  'date',
                  'expected',
                  'sold',
                  'difference',
                  'lost_sales',
                  'rowEvidence',
                  'supplied_unit',
                ] as const
              ).map((key) => (
                <th key={key} className="p-2 text-start">
                  {t(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.days.map((day) => (
              <tr key={day.date} className="border-t">
                {[day.date, day.expected_demand, day.sold, day.difference, day.lost_sales].map(
                  (value, index) => (
                    <td key={index} className="whitespace-nowrap p-2">
                      <bdi>{value}</bdi>
                    </td>
                  ),
                )}
                <td className="p-2">{t(day.recorded ? 'recorded' : 'confirmedZero')}</td>
                <td className="p-2">
                  <bdi>{day.supplied_unit ?? t('noRow')}</bdi>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
      <details className="min-w-0 workspace-panel text-sm">
        <summary className="cursor-pointer">{t('calculationEvidence')}</summary>
        <p className="mt-3">{t('method')}</p>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {(['absolute_error', 'squared_error'] as const).map((key) => (
            <div key={key} className="min-w-0">
              <dt>{t(key)}</dt>
              <dd className="break-all">
                <bdi>{report.totals[key]}</bdi>
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3">
          {t('sourceTime')}: <bdi>{report.source.scenario_saved_at}</bdi>
        </p>
        <p className="mt-2">{t('limits')}</p>
      </details>
      <details className="min-w-0 workspace-panel text-sm">
        <summary className="cursor-pointer">{t('copiedScenario')}</summary>
        <div className="mt-3">
          <InstalledBaseDemandReport report={report.source.scenario} />
        </div>
      </details>
    </div>
  )
}
