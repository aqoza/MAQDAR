import { getTranslations } from 'next-intl/server'
import {
  deliveryEvidenceReferences,
  type DeliveryExplanationEvidence,
} from '@/lib/delivery-explainer'
type Field =
  | keyof DeliveryExplanationEvidence['delivery_context']
  | keyof NonNullable<DeliveryExplanationEvidence['schedule']>
  | 'evaluated_days'
  | 'closed_days'
export async function DeliveryExplainerEvidence({
  evidence,
}: {
  evidence: DeliveryExplanationEvidence
}) {
  const t = await getTranslations('DeliveryExplainer'),
    common = await getTranslations('PolicyExplainer')
  const field = (key: Field, value: string | number | boolean) => (
    <div key={key} className="grid min-w-0 gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <dt className="text-muted-foreground">{t(`fields.${key}`)}</dt>
      <dd className="break-words tabular-nums [overflow-wrap:anywhere]">
        <bdi>{typeof value === 'boolean' ? t(value ? 'yes' : 'no') : String(value)}</bdi>
      </dd>
    </div>
  )
  return (
    <section className="min-w-0 space-y-3 workspace-panel" aria-labelledby="evidence-title">
      <h2 id="evidence-title" className="text-section-title">
        {common('evidenceTitle')}
      </h2>
      <p>
        {common('unit')}: <bdi>{evidence.unit}</bdi>
      </p>
      <p className="text-xs text-muted-foreground">{common('projection')}</p>
      {evidence.outcome === 'no_order_needed' ? (
        <p role="status">{t('noOrder')}</p>
      ) : evidence.schedule.policy_recalculation_required ? (
        <p role="status" className="rounded-md border border-amber-500/40 p-3">
          {t('timingWarning')}
        </p>
      ) : null}
      {deliveryEvidenceReferences.map((reference) => (
        <details
          key={reference}
          id={`evidence-${reference}`}
          className="scroll-mt-4 min-w-0 rounded-md border p-3"
          open={reference === 'schedule'}
        >
          <summary className="min-h-11 cursor-pointer font-medium md:min-h-0">
            {t(`references.${reference}`)}
          </summary>
          <div className="mt-3 min-w-0 space-y-3">
            {reference === 'delivery_limits' ? (
              <p>{t('limits')}</p>
            ) : reference === 'delivery_context' ? (
              <dl className="grid gap-2">
                {Object.entries(evidence.delivery_context).map(([key, value]) =>
                  field(key as keyof typeof evidence.delivery_context, value),
                )}
              </dl>
            ) : reference === 'schedule' ? (
              evidence.schedule ? (
                <>
                  <p className="text-xs">{t('scheduleNote')}</p>
                  <dl className="grid gap-2">
                    {Object.entries(evidence.schedule).map(([key, value]) =>
                      field(
                        key as keyof NonNullable<DeliveryExplanationEvidence['schedule']>,
                        value,
                      ),
                    )}
                  </dl>
                </>
              ) : (
                <p>{t('noSchedule')}</p>
              )
            ) : evidence.calendar_adjustments ? (
              <>
                <p>{t('confirmed')}</p>
                <p className="text-xs">{t('calendarNote')}</p>
                {(['supplier', 'receiver'] as const).map((side) => {
                  const search = evidence.calendar_adjustments![side]
                  return (
                    <section key={side} className="space-y-2">
                      <h3 className="font-medium">{t(side)}</h3>
                      <dl className="grid gap-2">
                        {field('evaluated_days', search.evaluated_days)}
                        {field('closed_days', search.closed_days)}
                        {Object.entries(search.closed_reasons).map(([reason, count]) => (
                          <div key={reason} className="flex flex-wrap justify-between gap-2">
                            <dt>{t(`reasons.${reason as keyof typeof search.closed_reasons}`)}</dt>
                            <dd className="tabular-nums">{count}</dd>
                          </div>
                        ))}
                      </dl>
                      <p>
                        {t('selectedReason')}: {t(`reasons.${search.selected_reason}`)}
                      </p>
                    </section>
                  )
                })}
              </>
            ) : (
              <p>{t('noCalendars')}</p>
            )}
          </div>
        </details>
      ))}
    </section>
  )
}
