import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { PolicySimulationForm } from '@/components/policy-simulation-form'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'
import { policyEvidenceSchema } from '@/lib/inventory-policy'
import { simulationEnd } from '@/lib/policy-simulation'
import { reportingDay } from '@/lib/dashboard'
import { firstParam, type RawSearchParams } from '@/lib/master-data/list-params'

export default async function NewSimulation({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const policyId = firstParam((await searchParams).policy)
  if (!policyId || !z.guid().safeParse(policyId).success) notFound()
  const [db, t, messages] = await Promise.all([
    createClient(),
    getTranslations('PolicySimulation'),
    getMessages(),
  ])
  const { data, error } = await db
    .from('inventory_policies')
    .select('id,item_code,unit,status,evidence')
    .eq('organization_id', context.active.id)
    .eq('id', policyId)
    .maybeSingle()
  if (error) throw new Error('Simulation policy unavailable')
  if (!data) notFound()
  const parsed = policyEvidenceSchema.safeParse(data.evidence)
  const evidence = parsed.success ? parsed.data : null
  const eligible =
    data.status === 'available' &&
    evidence &&
    evidence.forecast.method !== 'regional-v1' &&
    data.unit &&
    evidence.forecast.source?.unit_provenance?.status === 'consistent'
  const window = evidence
    ? simulationEnd(
        evidence.forecast.to_date,
        evidence.forecast.horizon,
        reportingDay(new Date(), context.active.effective_time_zone),
      )
    : null
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="forecasts"
        title={t('create')}
        description={data.item_code}
        back={
          <Link href={`/forecasts/workbench/${data.id}`} className="underline">
            {t('sourcePolicy')}
          </Link>
        }
        actions={
          <Link href="/forecasts/simulations" className="underline">
            {t('history')}
          </Link>
        }
        help={
          <HelpDisclosure>
            <p>{t('method')}</p>
            <p>{t('interpretation')}</p>
          </HelpDisclosure>
        }
      />
      {evidence && (
        <p>
          {t('fixedInputs', {
            cutoff: evidence.forecast.to_date,
            lead: evidence.options.lead_time,
            review: evidence.options.review_interval,
            maximum: evidence.output.protection?.target ?? '—',
            unit: data.unit ?? '—',
          })}
        </p>
      )}
      {eligible && window?.available && isEditorRole(context.role) ? (
        <NextIntlClientProvider messages={{ PolicySimulation: messages.PolicySimulation }}>
          <PolicySimulationForm
            organizationId={context.active.id}
            policyId={data.id}
            requestId={crypto.randomUUID()}
            first={window.first}
            last={window.last}
          />
        </NextIntlClientProvider>
      ) : (
        <p role="status">
          {t(
            !isEditorRole(context.role)
              ? 'readOnly'
              : !eligible
                ? 'ineligible'
                : 'noCompletedDates',
          )}
        </p>
      )}
    </div>
  )
}
