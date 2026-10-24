import { getTranslations } from 'next-intl/server'
import {
  replenishmentEvidenceReferences,
  type ReplenishmentExplanationEvidence,
} from '@/lib/replenishment-explainer'
type Field =
  | keyof ReplenishmentExplanationEvidence['draft_context']
  | keyof ReplenishmentExplanationEvidence['gap_calculation']
  | keyof ReplenishmentExplanationEvidence['supply_timing']
export async function ReplenishmentExplainerEvidence({
  evidence,
}: {
  evidence: ReplenishmentExplanationEvidence
}) {
  const t = await getTranslations('ReplenishmentExplainer'),
    common = await getTranslations('PolicyExplainer')
  return (
    <section className="min-w-0 space-y-3 workspace-panel" aria-labelledby="evidence-title">
      <h2 id="evidence-title" className="text-section-title">
        {common('evidenceTitle')}
      </h2>
      <p>
        {common('unit')}: <bdi>{evidence.unit}</bdi>
      </p>
      <p className="text-xs text-muted-foreground">{common('projection')}</p>
      {replenishmentEvidenceReferences.map((reference) => (
        <details
          key={reference}
          id={`evidence-${reference}`}
          className="scroll-mt-4 min-w-0 rounded-md border p-3"
          open={reference === 'gap_calculation'}
        >
          <summary className="min-h-11 cursor-pointer font-medium md:min-h-0">
            {t(`references.${reference}`)}
          </summary>
          <div className="mt-3 min-w-0 space-y-3">
            {reference === 'draft_limits' ? (
              <>
                <p>{t('confirmed')}</p>
                <p>{t('limits')}</p>
              </>
            ) : (
              <>
                {reference === 'gap_calculation' && (
                  <p className="text-xs">{t('calculationNote')}</p>
                )}
                {reference === 'supply_timing' && <p className="text-xs">{t('timingNote')}</p>}
                <dl className="grid gap-2">
                  {Object.entries(evidence[reference]).map(([key, value]) => (
                    <div
                      key={key}
                      className="grid min-w-0 gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
                    >
                      <dt className="text-muted-foreground">{t(`fields.${key as Field}`)}</dt>
                      <dd className="break-words tabular-nums [overflow-wrap:anywhere]">
                        {key === 'maximum_basis' ? (
                          t(value === 'approved' ? 'approved' : 'calculated')
                        ) : (
                          <bdi>{String(value)}</bdi>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
          </div>
        </details>
      ))}
    </section>
  )
}
