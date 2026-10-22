'use client'
import { useLocale, useTranslations } from 'next-intl'
import type { StockRegionReport as Report } from '@/lib/stock-regions'
import { TableScrollRegion } from './table-scroll-region'

export function StockRegionReport({ report }: { report: Report }) {
  const t = useTranslations('StockRegion'),
    locale = useLocale()
  return (
    <section className="min-w-0 space-y-3 workspace-panel" aria-label={t('membership')}>
      <h2 className="text-section-title">{t('membership')}</h2>
      <p className="break-words text-evidence-value">
        {locale.startsWith('ar') && report.input.name_ar
          ? report.input.name_ar
          : report.input.name_en}
      </p>
      <TableScrollRegion label={t('membership')}>
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr>
              <th className="p-3 text-start">{t('location_code')}</th>
              <th className="p-3 text-start">{t('location_name')}</th>
              <th className="p-3 text-start">{t('updatedAt')}</th>
            </tr>
          </thead>
          <tbody>
            {report.locations.map((location) => (
              <tr key={location.id} className="border-t">
                <td className="p-3">
                  <bdi>{location.code}</bdi>
                </td>
                <td className="max-w-80 break-words p-3">
                  {locale.startsWith('ar') && location.name_ar
                    ? location.name_ar
                    : location.name_en}
                </td>
                <td className="whitespace-nowrap p-3">
                  <bdi>{location.updated_at}</bdi>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
      <details className="min-w-0 text-xs">
        <summary className="min-h-11 cursor-pointer py-3">{t('evidence')}</summary>
        <p className="mb-3">{t('immutable')}</p>
        <ul className="space-y-2">
          {report.locations.map((location) => (
            <li key={location.id} className="break-all">
              <bdi>
                {location.code} · {location.id}
              </bdi>
            </li>
          ))}
        </ul>
        <p className="mt-3 break-all">
          {t('fingerprint')}: <bdi>{report.fingerprint}</bdi>
        </p>
      </details>
    </section>
  )
}
