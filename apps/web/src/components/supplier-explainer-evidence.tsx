import { getTranslations } from 'next-intl/server'
import {
  supplierEvidenceReferences,
  type SupplierExplanationEvidence,
} from '@/lib/supplier-explainer'
type Field =
  | keyof SupplierExplanationEvidence['scenario_context']
  | keyof SupplierExplanationEvidence['rounding_calculation']
  | keyof SupplierExplanationEvidence['lead_time_evidence']
export async function SupplierExplainerEvidence({
  evidence,
}: {
  evidence: SupplierExplanationEvidence
}) {
  const t = await getTranslations('SupplierExplainer'),
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
      {supplierEvidenceReferences.map((reference) => (
        <details
          key={reference}
          id={`evidence-${reference}`}
          className="scroll-mt-4 min-w-0 rounded-md border p-3"
          open={reference === 'rounding_calculation'}
        >
          <summary className="min-h-11 cursor-pointer font-medium md:min-h-0">
            {t(`references.${reference}`)}
          </summary>
          <div className="mt-3 min-w-0 space-y-3">
            {reference === 'scenario_limits' ? (
              <>
                <p>{t('confirmed')}</p>
                <p>{t('limits')}</p>
              </>
            ) : (
              <>
                {reference === 'rounding_calculation' && (
                  <p className="text-xs">{t('calculationNote')}</p>
                )}
                {reference === 'lead_time_evidence' && <p className="text-xs">{t('leadNote')}</p>}
                <dl className="grid gap-2">
                  {Object.entries(evidence[reference]).map(([key, value]) => (
                    <div
                      key={key}
                      className="grid min-w-0 gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
                    >
                      <dt className="text-muted-foreground">{t(`fields.${key as Field}`)}</dt>
                      <dd className="break-words tabular-nums [overflow-wrap:anywhere]">
                        <bdi>{String(value)}</bdi>
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
