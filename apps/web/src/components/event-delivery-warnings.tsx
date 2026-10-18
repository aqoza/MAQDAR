import { useLocale, useTranslations } from 'next-intl'
import type { EventDeliveryReport } from '@/lib/event-deliveries'

export function EventDeliveryWarnings({ report }: { report: EventDeliveryReport }) {
  const t = useTranslations('EventDeliveries')
  const locale = useLocale()
  const amount = (value: string) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(value as unknown as number)
  const unit = report.source.draft.scenario.event.input.unit
  const orders = report.source.draft.baseline.orders
  return (
    <>
      {report.policy_recalculation_required && (
        <p
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
        >
          {t('recalculate')}
        </p>
      )}
      {orders.some((order) => order.overdue || order.late) && (
        <p
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
        >
          {t('inboundWarning')}
        </p>
      )}
      {!!report.event_before_receipt?.length && (
        <div
          role="alert"
          className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
        >
          <p>{t('eventWarning')}</p>
          <details>
            <summary>
              {t('earlierEventDates', { count: report.event_before_receipt.length })}
            </summary>
            <ul className="mt-2 space-y-1">
              {report.event_before_receipt.map((event) => (
                <li key={event.date}>
                  <bdi>
                    {event.date} · {amount(event.quantity)} {unit}
                  </bdi>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </>
  )
}
