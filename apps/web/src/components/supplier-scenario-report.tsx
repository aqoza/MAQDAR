import { HelpDisclosure } from '@/components/help-disclosure'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { formatScore } from '@/lib/forecast-quality'
import type { SupplierScenarioReport as Report } from '@/lib/supplier-scenarios'

export async function SupplierScenarioReport({
  report,
  locale,
}: {
  report: Report
  locale: string
}) {
  const t = await getTranslations('SupplierScenarios')
  const amount = (v: string | null | undefined) => formatScore(v, locale)
  return (
    <section className="space-y-4" aria-label={t('result')}>
      <h2 className="text-section-title">{t('result')}</h2>
      <p role="status">{t(`statuses.${report.status}`)}</p>
      <p>
        {report.source.item_code} · {report.source.location_code} ·{' '}
        {t('cutoff', { date: report.source.cutoff })}
      </p>
      <p>
        {report.requested_supplier_code} {report.supplier && `· ${report.supplier.name}`}
      </p>
      <HelpDisclosure>
        <p>{t('formula')}</p>
        <p>{t('scenarioNote')}</p>
      </HelpDisclosure>
      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ['gap', report.source.gap, report.source.unit],
            ['moq', report.terms?.moq, report.terms?.unit],
            ['pack', report.terms?.pack, report.terms?.unit],
            ['quantity', report.quantity, report.source.unit],
            ['overage', report.overage, report.source.unit],
          ] as const
        ).map(([key, value, unit]) => (
          <div className="workspace-panel" key={key}>
            <p className="text-sm text-muted-foreground">{t(key)}</p>
            <p className="text-evidence-value wrap-anywhere tabular-nums">
              {amount(value)} {unit ?? '—'}
            </p>
          </div>
        ))}
      </div>
      <p>
        {t('leadTimes', {
          policy: report.source.lead_time ?? '—',
          supplier: report.terms?.lead_time ?? '—',
        })}
      </p>
      <p>{t(report.terms_confirmed ? 'confirmed' : 'unconfirmed')}</p>

      <details>
        <summary>{t('identity')}</summary>
        <p>{t('draftId', { id: report.source.draft_id })}</p>
        {report.terms && (
          <p>{t('termsId', { id: report.terms.id, time: report.terms.updated_at })}</p>
        )}
        {report.supplier && (
          <p>{t('supplierId', { id: report.supplier.id, time: report.supplier.updated_at })}</p>
        )}
      </details>
      <Link className="inline-block underline" href={`/replenishment/${report.source.draft_id}`}>
        {t('source')}
      </Link>
    </section>
  )
}
