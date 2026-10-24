import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { ForecastExplainerEvidence } from '@/components/forecast-explainer-evidence'
import { PolicyExplainerForm } from '@/components/policy-explainer-form'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { isEditorRole } from '@/lib/auth/roles'
import { explanationPath } from '@/lib/policy-explainer'
import { forecastExplanationPreviewSchema } from '@/lib/forecast-explainer'
import { policyExplainerConfiguration } from '@/lib/claude-policy.server'
export default async function ExplainForecast({
  searchParams,
}: {
  searchParams: Promise<{ forecast?: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { forecast: forecastId } = await searchParams
  if (!z.guid().safeParse(forecastId).success) notFound()
  const f = await getTranslations('ForecastExplainer')
  const [db, t, messages] = await Promise.all([
    createClient(),
    getTranslations('PolicyExplainer'),
    getMessages(),
  ])
  const [preview, settings] = await Promise.all([
    db.rpc('forecast_explainer_preview', {
      p_organization_id: context.active.id,
      p_forecast_id: forecastId!,
    }),
    db
      .from('policy_explainer_settings')
      .select('enabled')
      .eq('organization_id', context.active.id)
      .maybeSingle(),
  ])
  if (preview.error?.code === 'MQ404') notFound()
  if (settings.error || (preview.error && preview.error.code !== 'MQ422'))
    throw new Error('Policy evidence unavailable')
  const evidence = preview.error ? null : forecastExplanationPreviewSchema.parse(preview.data)
  const enabled = settings.data?.enabled ?? false
  const configured = Boolean(policyExplainerConfiguration())
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="forecasts"
        title={f('title')}
        description={f('description')}
        back={
          <Link
            href={
              evidence
                ? `/forecasts/results/${evidence.forecast_run_id}?item=${evidence.item_id}`
                : '/forecasts/quality'
            }
            className="underline"
          >
            {t('originalForecast')}
          </Link>
        }
        actions={
          <Link href={explanationPath} className="underline">
            {t('history')}
          </Link>
        }
        help={
          <HelpDisclosure>
            <p>{f('limits')}</p>
            <p>{t('quotas')}</p>
          </HelpDisclosure>
        }
      />
      {!evidence ? (
        <p role="status">{f('unavailable')}</p>
      ) : (
        <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
          <div className="min-w-0 space-y-3">
            {!configured ? (
              <p role="status" className="workspace-panel">
                {t('unconfigured')}
              </p>
            ) : !enabled ? (
              <p role="status" className="workspace-panel">
                {t('disabled')}
              </p>
            ) : isEditorRole(context.role) ? (
              <NextIntlClientProvider messages={{ PolicyExplainer: messages.PolicyExplainer }}>
                <PolicyExplainerForm
                  organizationId={context.active.id}
                  policyId={forecastId!}
                  kind="forecast"
                  fingerprint={evidence.fingerprint}
                  requestId={crypto.randomUUID()}
                />
              </NextIntlClientProvider>
            ) : (
              <p>{t('editorOnly')}</p>
            )}
            <Link
              href="/settings?section=policy-explainer"
              className="inline-flex min-h-11 items-center underline"
            >
              {t('settings')}
            </Link>
          </div>
          <ForecastExplainerEvidence evidence={evidence.evidence} />
        </div>
      )}
    </div>
  )
}
