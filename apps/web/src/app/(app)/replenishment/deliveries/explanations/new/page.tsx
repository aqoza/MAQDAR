import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { DeliveryExplainerEvidence } from '@/components/delivery-explainer-evidence'
import { PolicyExplainerForm } from '@/components/policy-explainer-form'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { isEditorRole } from '@/lib/auth/roles'
import { explanationPath } from '@/lib/policy-explainer'
import { deliveryExplanationPreviewSchema } from '@/lib/delivery-explainer'
import { policyExplainerConfiguration } from '@/lib/claude-policy.server'
export default async function ExplainDelivery({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { scenario: scenarioId } = await searchParams
  if (!z.guid().safeParse(scenarioId).success) notFound()
  const f = await getTranslations('DeliveryExplainer')
  const [db, t, messages] = await Promise.all([
    createClient(),
    getTranslations('PolicyExplainer'),
    getMessages(),
  ])
  const [preview, settings] = await Promise.all([
    db.rpc('delivery_explainer_preview', {
      p_organization_id: context.active.id,
      p_scenario_id: scenarioId!,
    }),
    db
      .from('policy_explainer_settings')
      .select('enabled')
      .eq('organization_id', context.active.id)
      .maybeSingle(),
  ])
  if (preview.error?.code === 'MQ404') notFound()
  if (settings.error || (preview.error && preview.error.code !== 'MQ422'))
    throw new Error('Delivery evidence unavailable')
  const evidence = preview.error ? null : deliveryExplanationPreviewSchema.parse(preview.data)
  const enabled = settings.data?.enabled ?? false
  const configured = Boolean(policyExplainerConfiguration())
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="replenishment"
        title={f('title')}
        description={f('description')}
        back={
          <Link
            href={evidence ? `/replenishment/deliveries/${evidence.scenario_id}` : '/replenishment'}
            className="underline"
          >
            {f('originalScenario')}
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
                  sourceId={scenarioId!}
                  kind="delivery"
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
          <DeliveryExplainerEvidence evidence={evidence.evidence} />
        </div>
      )}
    </div>
  )
}
