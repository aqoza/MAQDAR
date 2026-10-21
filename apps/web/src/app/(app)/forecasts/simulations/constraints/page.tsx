import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { PolicyConfigurationsForm } from '@/components/policy-configurations-form'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'
import { simulationEvidenceSchema } from '@/lib/policy-simulation'
import { firstParam, type RawSearchParams } from '@/lib/master-data/list-params'

export default async function NewConstraints({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const sourceRunId = firstParam((await searchParams).source)
  if (!sourceRunId || !z.guid().safeParse(sourceRunId).success) notFound()
  const [db, t, simulation, messages] = await Promise.all([
    createClient(),
    getTranslations('PolicyConstraints'),
    getTranslations('PolicySimulation'),
    getMessages(),
  ])
  const { data, error } = await db
    .from('policy_simulations')
    .select('evidence,planning_runs!inner(status,locations!inner(is_active))')
    .eq('organization_id', context.active.id)
    .eq('run_id', sourceRunId)
    .maybeSingle()
  if (error) throw new Error('Source simulation unavailable')
  if (!data) notFound()
  const parsed = simulationEvidenceSchema.safeParse(data.evidence)
  const source = parsed.success ? parsed.data : null
  const eligible =
    source && data.planning_runs.status === 'succeeded' && data.planning_runs.locations.is_active
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="forecasts"
        title={t('create')}
        description={source?.policy.item_code}
        back={
          <Link href={`/forecasts/simulations/${sourceRunId}`} className="underline">
            {t('source')}
          </Link>
        }
        help={
          <HelpDisclosure>
            <p className="text-xs">{t('interpretation')}</p>
            <p className="text-xs">{t('roundingHelp')}</p>
            <p className="text-xs">{simulation('method')}</p>
          </HelpDisclosure>
        }
      />
      {source && (
        <div className="workspace-panel space-y-2">
          <h2 className="text-section-title">{t('fixedEvidence')}</h2>
          <p>
            {simulation('fixedInputs', {
              cutoff: source.policy.cutoff,
              lead: source.policy.lead_time,
              review: source.policy.review_interval,
              maximum: source.policy.maximum,
              unit: source.policy.unit,
            })}
          </p>
          <p>
            {source.from_date} – {source.to_date} ·{' '}
            {t('startingState', {
              stock: source.options.opening_stock,
              unit: source.policy.unit,
            })}
          </p>
        </div>
      )}
      {eligible && isEditorRole(context.role) ? (
        <NextIntlClientProvider messages={{ PolicyConstraints: messages.PolicyConstraints }}>
          <PolicyConfigurationsForm
            constraints
            organizationId={context.active.id}
            sourceRunId={sourceRunId}
            requestId={crypto.randomUUID()}
            alternative={source.options.alternative_maximum}
            lead={source.policy.lead_time}
            review={source.policy.review_interval}
          />
        </NextIntlClientProvider>
      ) : (
        <p role="status">{isEditorRole(context.role) ? t('ineligible') : simulation('readOnly')}</p>
      )}
    </div>
  )
}
