import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { PolicyExplainerEvidence } from '@/components/policy-explainer-evidence'
import { PolicyExplainerForm } from '@/components/policy-explainer-form'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { isEditorRole } from '@/lib/auth/roles'
import { explanationPreviewSchema, explanationPath } from '@/lib/policy-explainer'
import { policyExplainerConfiguration } from '@/lib/claude-policy.server'
export default async function ExplainPolicy({ params }: { params: Promise<{ policyId: string }> }) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { policyId } = await params
  if (!z.guid().safeParse(policyId).success) notFound()
  const [db, t, messages] = await Promise.all([
    createClient(),
    getTranslations('PolicyExplainer'),
    getMessages(),
  ])
  const [preview, settings] = await Promise.all([
    db.rpc('policy_explainer_preview', {
      p_organization_id: context.active.id,
      p_policy_id: policyId,
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
  const evidence = preview.error ? null : explanationPreviewSchema.parse(preview.data)
  const enabled = settings.data?.enabled ?? false
  const configured = Boolean(policyExplainerConfiguration())
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="forecasts"
        title={t('title')}
        description={t('description')}
        back={
          <Link href={`/forecasts/workbench/${policyId}`} className="underline">
            {t('backPolicy')}
          </Link>
        }
        actions={
          <Link href={explanationPath} className="underline">
            {t('history')}
          </Link>
        }
        help={
          <HelpDisclosure>
            <p>{t('limits')}</p>
            <p>{t('quotas')}</p>
          </HelpDisclosure>
        }
      />
      {!evidence ? (
        <p role="status">{t('unavailable')}</p>
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
                  sourceId={policyId}
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
          <PolicyExplainerEvidence evidence={evidence.evidence} />
        </div>
      )}
    </div>
  )
}
