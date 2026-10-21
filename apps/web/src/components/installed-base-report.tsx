'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { PopulationReport } from '@/lib/installed-base'
import { TableScrollRegion } from './table-scroll-region'

export function InstalledBaseReport({ report }: { report: PopulationReport }) {
  const t = useTranslations('InstalledBase')
  const [page, setPage] = useState(1)
  const pages = Math.ceil(report.groups.length / 50)
  return (
    <div className="min-w-0 space-y-4">
      <dl className="grid gap-3 workspace-panel sm:grid-cols-2 lg:grid-cols-4">
        {(['item_code', 'location_code', 'unit', 'as_of', 'available_on', 'source'] as const).map(
          (key) => (
            <div key={key} className={`min-w-0 ${key === 'source' ? 'sm:col-span-2' : ''}`}>
              <dt className="text-xs text-muted-foreground">{t(key)}</dt>
              <dd className="break-words text-evidence-value">
                <bdi>{report.input[key]}</bdi>
              </dd>
            </div>
          ),
        )}
      </dl>
      <section className="min-w-0 workspace-panel" aria-label={t('summary')}>
        <h2 className="text-subsection-title">{t('summary')}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t('quantityMeaning')}</p>
        <dl className="mt-3 grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3">
          {Object.entries(report.totals).map(([key, value]) => (
            <div key={key} className="min-w-0">
              <dt className="text-xs text-muted-foreground">
                {t(`totals.${key as keyof PopulationReport['totals']}`)}
              </dt>
              <dd className="break-words text-evidence-value">
                <bdi>{value}</bdi>
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <TableScrollRegion label={t('groups')}>
        <table className="w-full min-w-[48rem] text-sm">
          <caption className="sr-only">{t('groups')}</caption>
          <thead>
            <tr>
              {(
                [
                  'group_code',
                  'group_name',
                  'installed_on',
                  'age_days',
                  'active_assets',
                  'parts_per_asset',
                  'installed_quantity',
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
                <td className="max-w-60 break-words p-2">
                  <bdi>{group.group_code}</bdi>
                </td>
                <td className="max-w-80 break-words p-2">
                  <bdi>{group.group_name}</bdi>
                </td>
                <td className="whitespace-nowrap p-2">
                  <bdi>{group.installed_on ?? t('unknown')}</bdi>
                </td>
                <td className="whitespace-nowrap p-2">
                  <bdi>{group.age_days ?? t('unknown')}</bdi>
                </td>
                <td className="whitespace-nowrap p-2">
                  <bdi>{group.active_assets}</bdi>
                </td>
                <td className="whitespace-nowrap p-2">
                  <bdi>{group.parts_per_asset}</bdi>
                </td>
                <td className="whitespace-nowrap p-2">
                  <bdi>{group.installed_quantity}</bdi>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
      {pages > 1 && (
        <nav className="flex flex-wrap items-center gap-3" aria-label={t('groups')}>
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
