import Link from 'next/link'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import type { BatchPreview } from '@/lib/excess-disposition-batches'
import { formatCostDecimal } from '@/lib/purchase-costs'
import { formatDateOnly } from '@/lib/format'
import { TableScrollRegion } from '@/components/table-scroll-region'

export async function ExcessDispositionBatchEvidence({
  report,
}: {
  report: Pick<BatchPreview, 'summary' | 'lines'>
}) {
  const [t, dt, locale, format] = await Promise.all([
    getTranslations('ExcessDispositionBatches'),
    getTranslations('ExcessDisposition'),
    getLocale(),
    getFormatter(),
  ])
  const s = report.summary
  return (
    <section className="min-w-0 space-y-3" aria-label={t('evidence')}>
      <h2 className="text-section-title">{t('evidence')}</h2>
      <dl className="grid min-w-0 gap-3 workspace-panel sm:grid-cols-2 lg:grid-cols-4">
        {[
          [t('location'), s.location_code],
          [t('kind'), dt(`kinds.${s.kind}`)],
          [t('cutoff'), formatDateOnly(format, s.cutoff)],
          [
            t('referenceValue'),
            `${formatCostDecimal(s.reference_value, locale, 100)} ${s.currency}`,
          ],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 break-words">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-evidence-value">
              <bdi>{value}</bdi>
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">{t('valueNote')}</p>
      <TableScrollRegion label={t('evidence')} className="workspace-table">
        <table className="w-full min-w-[48rem] text-sm">
          <caption className="sr-only">{t('evidence')}</caption>
          <thead>
            <tr>
              {(['item', 'quantity', 'lineValue', 'reason', 'evidence'] as const).map((key) => (
                <th key={key} className="p-2 text-start">
                  {t(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.lines.map((line) => (
              <tr className="border-t" key={line.handoff_id}>
                <th className="p-2 text-start">
                  <bdi>{line.disposition.item_code}</bdi>
                </th>
                <td className="p-2">
                  <bdi>
                    {formatCostDecimal(line.disposition.quantity, locale, 100)}{' '}
                    {line.disposition.unit}
                  </bdi>
                </td>
                <td className="p-2">
                  <bdi>
                    {formatCostDecimal(line.disposition.reference_value, locale, 100)}{' '}
                    {line.disposition.currency}
                  </bdi>
                </td>
                <td className="max-w-64 whitespace-pre-wrap break-words p-2">
                  {line.proposal.reason}
                </td>
                <td className="p-2">
                  <Link
                    prefetch={false}
                    className="underline"
                    href={`/replenishment/excess/handoffs/${line.handoff_id}`}
                  >
                    {t('inspectLine', { item: line.disposition.item_code })}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
      <details className="workspace-panel">
        <summary className="cursor-pointer">{t('originals')}</summary>
        <p className="my-2 text-xs text-muted-foreground">{t('copiedNote')}</p>
        <pre className="max-w-full whitespace-pre-wrap break-all text-xs">
          {JSON.stringify(report.lines, null, 2)}
        </pre>
      </details>
    </section>
  )
}
