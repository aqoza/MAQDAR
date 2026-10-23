import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { RegionalFreightReport } from '@/components/regional-freight-report'
import { type BatchPreview } from '@/lib/regional-batches'
import { formatCostDecimal, formatPurchaseCost } from '@/lib/purchase-costs'
import { formatDateOnly } from '@/lib/format'

export async function RegionalBatchEvidence({
  report,
}: {
  report: Pick<BatchPreview, 'summary' | 'lines' | 'item_identities'>
}) {
  const [t, locale, format] = await Promise.all([
    getTranslations('RegionalBatches'),
    getLocale(),
    getFormatter(),
  ])
  const s = report.summary
  return (
    <section className="min-w-0 space-y-3">
      <h2 className="text-section-title">{t('evidence')}</h2>
      <dl className="grid min-w-0 gap-3 workspace-panel sm:grid-cols-2 lg:grid-cols-5">
        {[
          [
            t('region'),
            locale.startsWith('ar') ? s.region_name_ar || s.region_name : s.region_name,
          ],
          [t('destination'), s.destination_code],
          [t('dispatchDate'), formatDateOnly(format, s.requested_date)],
          [t('lines'), String(s.handoff_count)],
          [t('branches'), String(s.source_row_count)],
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
                  'actualDispatch',
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
                const policy = line.estimate.source.source.destination.policy
                const zero = branch.status === 'no_transfer_needed'
                return (
                  <tr className="border-t" key={`${line.handoff_id}-${branch.location_id}`}>
                    <th className="p-2 text-start">{policy?.item_code}</th>
                    <td className="p-2">{branch.location_code}</td>
                    <td className="p-2 whitespace-nowrap">
                      {formatCostDecimal(branch.quantity, locale)} {policy?.unit}
                    </td>
                    <td className="p-2 whitespace-nowrap">{policy?.cutoff}</td>
                    <td className="p-2 whitespace-nowrap">
                      {zero ? t('noTransfer') : (dates?.dispatch?.date ?? t('unavailable'))}
                    </td>
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
              item: line.estimate.source.source.destination.policy?.item_code ?? '—',
            })}
          </summary>
          <div className="min-w-0 space-y-3 pt-3">
            <p className="text-xs break-all text-muted-foreground">
              {t('handoffIdentity', { id: line.handoff_id })}
            </p>
            <p className="text-xs break-all text-muted-foreground">
              {t('itemIdentity', {
                id:
                  report.item_identities.find((entry) => entry.handoff_id === line.handoff_id)
                    ?.item_id ?? '—',
              })}
            </p>
            <p className="text-xs break-all text-muted-foreground">
              {t('proposalIdentity', { id: line.proposal.id })}
            </p>
            <p>
              {t('approvalAt', {
                time: format.dateTime(new Date(line.proposal.approved_at), 'long'),
              })}
            </p>
            <p className="whitespace-pre-wrap">
              {t('approvalReason')}: {line.proposal.approval_reason}
            </p>
            <RegionalFreightReport report={line.estimate} locale={locale} />
          </div>
        </details>
      ))}
    </section>
  )
}
