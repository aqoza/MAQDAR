'use client'
import { useLocale, useTranslations } from 'next-intl'
import { StockRegionReport } from './stock-region-report'
import type { RegionalStockReport as Report } from '@/lib/regional-stock'
import { TableScrollRegion } from './table-scroll-region'
export function RegionalStockReport({ report }: { report: Report }) {
  const t = useTranslations('RegionalStock'),
    locale = useLocale()
  return (
    <div className="min-w-0 space-y-4">
      <section aria-label={t('totals')} className="space-y-3 workspace-panel">
        <h2 className="text-section-title">{t('totals')}</h2>
        <p className="break-words text-sm">
          <bdi>{report.item.code}</bdi> ·{' '}
          {locale.startsWith('ar') && report.item.name_ar
            ? report.item.name_ar
            : report.item.name_en}{' '}
          ·{' '}
          <bdi>
            {report.input.unit} · {report.input.as_of}
          </bdi>
        </p>
        {report.totals ? (
          <dl className="grid gap-3 sm:grid-cols-3">
            {(['on_hand', 'allocated', 'net'] as const).map((key) => (
              <div key={key} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{t(key)}</dt>
                <dd className="break-all text-evidence-value">
                  <bdi>{report.totals![key]}</bdi>
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p role="status" className="text-sm text-destructive">
            {t('incomplete')}
          </p>
        )}
      </section>
      {report.region && (
        <details className="min-w-0 workspace-panel text-sm">
          <summary className="min-h-11 cursor-pointer py-3">
            {t('capturedRegion')}:{' '}
            {locale.startsWith('ar') && report.region.name_ar
              ? report.region.name_ar
              : report.region.name_en}
          </summary>
          <p className="my-3 break-all text-xs">
            <bdi>
              {report.region.id} · {report.region.created_at}
            </bdi>
          </p>
          <StockRegionReport report={report.region.definition} />
        </details>
      )}
      <TableScrollRegion label={t('lines')}>
        <table className="w-full min-w-[60rem] text-sm">
          <thead>
            <tr>
              {(
                [
                  'location_code',
                  'snapshot',
                  'age',
                  'unit',
                  'on_hand',
                  'allocated',
                  'net',
                  'status',
                ] as const
              ).map((key) => (
                <th key={key} className="p-3 text-start">
                  {t(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.lines.map((line) => (
              <tr key={line.location_id} className="border-t">
                <td className="max-w-64 break-words p-3">
                  <bdi>{line.code}</bdi>
                  <p className="text-xs text-muted-foreground">
                    {locale.startsWith('ar') && line.name_ar ? line.name_ar : line.name_en}
                  </p>
                </td>
                <td className="whitespace-nowrap p-3">
                  <bdi>{line.snapshot?.date ?? '—'}</bdi>
                </td>
                <td className="p-3">{line.snapshot?.age_days ?? '—'}</td>
                <td className="p-3">
                  <bdi>{line.snapshot?.unit ?? '—'}</bdi>
                </td>
                {(['on_hand', 'allocated', 'net'] as const).map((key) => (
                  <td key={key} className="whitespace-nowrap p-3">
                    <bdi>{line.snapshot?.[key] ?? '—'}</bdi>
                  </td>
                ))}
                <td className="p-3">{t(line.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
      <details className="min-w-0 workspace-panel text-sm">
        <summary className="cursor-pointer py-2">{t('savedEvidence')}</summary>
        <p className="my-3">{t('immutable')}</p>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t('itemIdentity')}</dt>
            <dd className="break-all">
              <bdi>{report.item.id}</bdi>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t('fingerprint')}</dt>
            <dd className="break-all">{report.fingerprint}</dd>
          </div>
        </dl>
        <ul className="mt-3 space-y-3">
          {report.lines.map((line) => (
            <li key={line.location_id} className="break-all">
              <bdi>
                {line.code} · {line.location_id}
              </bdi>
              <p>
                {t('snapshotIdentity')}: <bdi>{line.snapshot?.id ?? '—'}</bdi>
              </p>
              <p>
                {t('updatedAt')}: <bdi>{line.snapshot?.updated_at ?? '—'}</bdi>
              </p>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
