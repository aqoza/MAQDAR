import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import { TableScrollRegion } from './table-scroll-region'
import { HelpDisclosure } from './help-disclosure'
import { returnHandoffsPath } from '@/lib/dealer-return-handoffs'
import { type ReturnBatchPreview } from '@/lib/dealer-return-batches'

export async function DealerReturnBatchEvidence({
  report,
}: {
  report: Pick<ReturnBatchPreview, 'summary' | 'lines'>
}) {
  const [t, r, format] = await Promise.all([
    getTranslations('DealerReturnBatches'),
    getTranslations('DealerReturns'),
    getFormatter(),
  ])
  return (
    <>
      <dl className="grid min-w-0 gap-4 workspace-panel sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            ['source_code', report.summary.source_code],
            ['location_code', report.summary.location_code],
            ['requested_date', report.summary.requested_date],
          ] as const
        ).map(([key, value]) => (
          <div key={key}>
            <dt className="text-xs text-muted-foreground">{r(key)}</dt>
            <dd className="break-words text-evidence-value">
              <bdi>{value}</bdi>
            </dd>
          </div>
        ))}
        <div>
          <dt className="text-xs text-muted-foreground">{t('lines')}</dt>
          <dd className="text-evidence-value">{report.summary.line_count}</dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">{t('dateNote')}</p>
      <TableScrollRegion label={t('evidence')}>
        <table className="w-full min-w-[54rem] text-sm">
          <caption className="sr-only">{t('evidence')}</caption>
          <thead>
            <tr>
              {(['item_code', 'quantity', 'condition', 'sale_reference'] as const).map((key) => (
                <th scope="col" key={key} className="p-2 text-start text-xs">
                  {r(key)}
                </th>
              ))}
              <th scope="col" className="p-2 text-start text-xs">
                {t('approval')}
              </th>
            </tr>
          </thead>
          <tbody>
            {report.lines.map((line) => {
              const v = line.request.report
              return (
                <tr key={line.handoff_id} className="border-t">
                  <td className="p-2">
                    <Link
                      prefetch={false}
                      className="inline-flex min-h-11 items-center underline"
                      href={returnHandoffsPath + '/' + line.handoff_id}
                    >
                      <bdi>{v.item.code}</bdi>
                    </Link>
                  </td>
                  <td className="whitespace-nowrap p-2">
                    <bdi>
                      {v.input.quantity} {v.input.unit}
                    </bdi>
                  </td>
                  <td className="p-2">{r(v.input.condition)}</td>
                  <td className="max-w-64 break-words p-2">
                    <bdi>{v.input.sale_reference ?? r('notSupplied')}</bdi>
                  </td>
                  <td className="max-w-96 break-words p-2">
                    <HelpDisclosure label={t('approval')}>
                      <p>
                        {format.dateTime(new Date(line.approval.decided_at), 'long')} ·{' '}
                        <bdi>{line.approval.reviewer_email ?? r('notSupplied')}</bdi>
                      </p>
                      <p>{line.approval.reason}</p>
                      <p>{r('eligibilityRecorded')}</p>
                      <p>
                        {r('reason')}: {v.input.reason}
                      </p>
                      <p className="break-all text-xs">
                        {t('requestId')}: {line.request.id}
                      </p>
                    </HelpDisclosure>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </TableScrollRegion>
    </>
  )
}
