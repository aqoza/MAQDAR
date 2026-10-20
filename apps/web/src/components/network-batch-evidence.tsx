import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { NetworkFreightReport } from '@/components/network-freight-report'
import { type BatchPreview } from '@/lib/network-batches'
import { formatCostDecimal, formatPurchaseCost } from '@/lib/purchase-costs'
import { formatDateOnly } from '@/lib/format'

export async function NetworkBatchEvidence({
  report,
}: {
  report: Pick<BatchPreview, 'summary' | 'lines'>
}) {
  const [t, locale, format] = await Promise.all([
    getTranslations('NetworkBatches'),
    getLocale(),
    getFormatter(),
  ])
  const s = report.summary
  return (
    <section className="min-w-0 space-y-3">
      <h2 className="text-section-title">{t('evidence')}</h2>
      <dl className="grid min-w-0 gap-3 workspace-panel sm:grid-cols-2 lg:grid-cols-4">
        {[
          [t('source'), s.source_code],
          [t('dispatchDate'), formatDateOnly(format, s.dispatch_date)],
          [t('lines'), String(s.handoff_count)],
          [t('branches'), String(s.branch_row_count)],
        ].map(([label, value]) => (
          <div className="min-w-0" key={label}>
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="text-evidence-value">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="workspace-panel">
        <h3 className="text-subsection-title">{t('subtotal')}</h3>
        {s.totals.map((total) => (
          <p className="text-evidence-value" key={total.currency}>
            {formatPurchaseCost(total.subtotal, total.currency, total.minor_units, locale)}
          </p>
        ))}
        <p className="text-muted-foreground">{t('totalNote')}</p>
      </div>
      <TableScrollRegion label={t('evidence')}>
        <table className="w-full min-w-[64rem] text-sm">
          <caption className="sr-only">{t('evidence')}</caption>
          <thead>
            <tr>
              {(
                [
                  'item',
                  'branch',
                  'quantity',
                  'cutoff',
                  'typicalReceipt',
                  'slowReceipt',
                  'lineSubtotal',
                ] as const
              ).map((key) => (
                <th key={key} className="p-2 text-start">
                  {t(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.lines.flatMap((line) =>
              line.estimate.lines.map((branch) => {
                const dates = line.estimate.source.lines.find(
                  (d) => d.location_id === branch.location_id,
                )
                const policy = line.estimate.source.source.source_policy
                const zero = branch.status === 'no_transfer_needed'
                return (
                  <tr className="border-t" key={`${line.handoff_id}-${branch.location_id}`}>
                    <th className="p-2 text-start">{policy?.item_code}</th>
                    <td className="p-2">{branch.location_code}</td>
                    <td className="p-2 whitespace-nowrap">
                      {formatCostDecimal(branch.quantity, locale)} {policy?.unit}
                    </td>
                    <td className="p-2 whitespace-nowrap">{policy?.cutoff}</td>
                    {(['p50', 'p90'] as const).map((p) => (
                      <td key={p} className="p-2 whitespace-nowrap">
                        {zero
                          ? t('noTransfer')
                          : (dates?.receipts[p]?.search.date ?? t('unavailable'))}
                      </td>
                    ))}
                    <td className="p-2 whitespace-nowrap">
                      {zero
                        ? t('noTransfer')
                        : branch.terms && branch.subtotal != null
                          ? formatPurchaseCost(
                              branch.subtotal,
                              branch.terms.currency,
                              branch.terms.minor_units,
                              locale,
                            )
                          : t('unavailable')}
                    </td>
                  </tr>
                )
              }),
            )}
          </tbody>
        </table>
      </TableScrollRegion>
      {report.lines.map((line) => (
        <details className="min-w-0 workspace-panel" key={line.handoff_id}>
          <summary className="cursor-pointer text-subsection-title">
            {t('copiedEvidence', {
              item: line.estimate.source.source.source_policy?.item_code ?? '—',
            })}
          </summary>
          <div className="min-w-0 space-y-3 pt-3">
            <p className="break-all">{t('handoffIdentity', { id: line.handoff_id })}</p>
            <p className="break-all">{t('proposalIdentity', { id: line.proposal.id })}</p>
            <p>
              {t('approvalAt', {
                time: format.dateTime(new Date(line.proposal.approved_at), 'long'),
              })}
            </p>
            <p className="whitespace-pre-wrap">
              {t('approvalReason')}: {line.proposal.approval_reason}
            </p>
            <NetworkFreightReport report={line.estimate} locale={locale} />
          </div>
        </details>
      ))}
    </section>
  )
}
