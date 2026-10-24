import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { PolicyExplainerEvidence } from '@/components/policy-explainer-evidence'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { explanationPath, explanationStatus } from '@/lib/policy-explainer'
import { aiExplanationRecordSchema } from '@/lib/ai-explanations'
import { forecastEvidenceReferences } from '@/lib/forecast-explainer'
import { type EvidenceReference } from '@/lib/policy-explainer'
import { ForecastExplainerEvidence } from '@/components/forecast-explainer-evidence'
export default async function ExplanationDetail({
  params,
}: {
  params: Promise<{ explanationId: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { explanationId } = await params
  if (!z.guid().safeParse(explanationId).success) notFound()
  const [db, t] = await Promise.all([createClient(), getTranslations('PolicyExplainer')])
  const { data, error } = await db
    .from('policy_explanations')
    .select('*')
    .eq('organization_id', context.active.id)
    .eq('id', explanationId)
    .maybeSingle()
  if (error) throw new Error('Explanation unavailable')
  if (!data) notFound()
  const row = aiExplanationRecordSchema.parse(data)
  const f = await getTranslations('ForecastExplainer')
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="forecasts"
        title={row.subject_kind === 'forecast' ? f('savedTitle') : t('savedTitle')}
        description={t('aiLabel')}
        back={
          <Link href={explanationPath} className="underline">
            {t('history')}
          </Link>
        }
        help={
          <HelpDisclosure>
            <p>{row.subject_kind === 'forecast' ? f('limits') : t('limits')}</p>
            <p>{t('retention')}</p>
          </HelpDisclosure>
        }
      />
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
        <article className="min-w-0 space-y-4 workspace-panel">
          <h2 className="text-section-title">{t('question')}</h2>
          <p dir="auto" className="break-words [overflow-wrap:anywhere]">
            {row.question}
          </p>
          <p role="status">{t(`statuses.${explanationStatus(row.status, row.created_at)}`)}</p>
          {row.answer?.paragraphs.map((paragraph, index) => (
            <section key={index} className="space-y-2">
              <p dir="auto" className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                {paragraph.text}
              </p>
              <nav
                aria-label={t('paragraphEvidence', { number: index + 1 })}
                className="flex flex-wrap gap-x-3 gap-y-1"
              >
                {[...new Set(paragraph.references)].map((reference) => (
                  <a
                    key={reference}
                    href={`#evidence-${reference}`}
                    className="min-h-11 py-3 text-xs underline md:min-h-0 md:py-0"
                  >
                    {row.subject_kind === 'forecast'
                      ? f(`references.${reference as (typeof forecastEvidenceReferences)[number]}`)
                      : t(`references.${reference as EvidenceReference}`)}
                  </a>
                ))}
              </nav>
            </section>
          ))}
          {row.status === 'failed' && <p>{t('failure')}</p>}
          <p className="text-xs text-muted-foreground break-words">
            {t('model')}: {row.response_model ?? row.requested_model ?? '—'} · {row.prompt_version}{' '}
            · {t('apiVersion')}: {row.api_version}
          </p>
          <div className="flex flex-wrap gap-4">
            {row.subject_kind === 'policy' && (
              <Link
                href={`/forecasts/policies/${row.policy_run_id}`}
                className="min-h-11 py-3 underline"
              >
                {t('originalPolicy')}
              </Link>
            )}
            <Link
              href={`/forecasts/results/${row.forecast_run_id}?item=${row.item_id}`}
              className="min-h-11 py-3 underline"
            >
              {t('originalForecast')}
            </Link>
          </div>
        </article>
        {row.subject_kind === 'forecast' ? (
          <ForecastExplainerEvidence evidence={row.evidence} />
        ) : (
          <PolicyExplainerEvidence evidence={row.evidence} />
        )}
      </div>
    </div>
  )
}
