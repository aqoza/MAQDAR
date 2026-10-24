import { getTranslations } from 'next-intl/server'
import {
  evidenceReferences,
  type EvidenceField,
  type ExplanationEvidence,
} from '@/lib/policy-explainer'
export async function PolicyExplainerEvidence({ evidence }: { evidence: ExplanationEvidence }) {
  const t = await getTranslations('PolicyExplainer')
  return (
    <section className="min-w-0 space-y-3 workspace-panel" aria-labelledby="evidence-title">
      <h2 id="evidence-title" className="text-section-title">
        {t('evidenceTitle')}
      </h2>
      <p>
        {t('unit')}: {evidence.unit} · {t('cutoff')}: {evidence.cutoff}
      </p>
      <p className="text-xs text-muted-foreground">{t('projection')}</p>
      {evidenceReferences.map((reference) => (
        <details
          key={reference}
          id={`evidence-${reference}`}
          className="scroll-mt-4 rounded-md border p-3"
          open={reference === 'policy_inputs'}
        >
          <summary className="min-h-11 cursor-pointer font-medium md:min-h-0">
            {t(`references.${reference}`)}
          </summary>
          <dl className="mt-3 grid min-w-0 gap-2">
            {Object.entries(evidence[reference]).map(([key, value]) => (
              <div
                key={key}
                className="grid min-w-0 gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
              >
                <dt className="text-muted-foreground">{t(`fields.${key as EvidenceField}`)}</dt>
                <dd className="break-words tabular-nums [overflow-wrap:anywhere]">
                  {key === 'interpretation' ? t('interpretation') : String(value)}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ))}
    </section>
  )
}
