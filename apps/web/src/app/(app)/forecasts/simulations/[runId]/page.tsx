import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { PolicySimulationReport } from '@/components/policy-simulation-report'
import { PolicySensitivityReport } from '@/components/policy-sensitivity-report'
import { PlanningRefresh, CancelPlanningRun } from '@/components/planning-controls'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'
import { isActiveRun } from '@/lib/planning'
import { simulationEvidenceSchema } from '@/lib/policy-simulation'
import { sensitivityEvidenceSchema } from '@/lib/policy-sensitivity'
import { configurationsEvidenceSchema } from '@/lib/policy-configurations'
import { firstParam, type RawSearchParams } from '@/lib/master-data/list-params'

export default async function SimulationResult({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { runId } = await params
  if (!z.guid().safeParse(runId).success) notFound()
  const [db, t, planning, sensitivity, configurations] = await Promise.all([
    createClient(),
    getTranslations('PolicySimulation'),
    getTranslations('Planning'),
    getTranslations('PolicySensitivity'),
    getTranslations('PolicyConfigurations'),
  ])
  const { data: run, error } = await db
    .from('planning_runs')
    .select('id,kind,status,from_date,to_date,options,locations(code)')
    .eq('organization_id', context.active.id)
    .eq('id', runId)
    .maybeSingle()
  if (error) throw new Error('Simulation run unavailable')
  if (!run || run.kind !== 'simulation') notFound()
  const active = isActiveRun(run.status)
  const response =
    run.status === 'succeeded'
      ? await db
          .from('policy_simulations')
          .select('evidence')
          .eq('organization_id', context.active.id)
          .eq('run_id', runId)
          .maybeSingle()
      : null
  if (response?.error || (run.status === 'succeeded' && !response?.data))
    throw new Error('Simulation result unavailable')
  const method = (run.options as { method?: string } | null)?.method
  const comparison =
    response?.data && method === 'periodic-sensitivity-v1'
      ? sensitivityEvidenceSchema.parse(response.data.evidence)
      : response?.data && method === 'periodic-configurations-v1'
        ? configurationsEvidenceSchema.parse(response.data.evidence)
        : null
  const original =
    response?.data && !comparison ? simulationEvidenceSchema.parse(response.data.evidence) : null
  const evidence = comparison ?? original
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="forecasts"
        title={
          method === 'periodic-configurations-v1'
            ? configurations('title')
            : method === 'periodic-sensitivity-v1'
              ? sensitivity('title')
              : t('title')
        }
        description={`${run.locations?.code ?? ''} · ${run.from_date} – ${run.to_date}`}
        back={
          <Link href="/forecasts/simulations" className="underline">
            {t('history')}
          </Link>
        }
        actions={
          evidence ? (
            <>
              <Link
                href={
                  comparison
                    ? `/forecasts/simulations/${comparison.source_simulation.run_id}`
                    : `/forecasts/workbench/${evidence.policy.id}`
                }
                className="underline"
              >
                {comparison ? sensitivity('source') : t('sourcePolicy')}
              </Link>
              {original && isEditorRole(context.role) && (
                <>
                  <Link
                    href={`/forecasts/simulations/compare?source=${runId}`}
                    className="underline"
                  >
                    {sensitivity('create')}
                  </Link>
                  <Link
                    href={`/forecasts/simulations/configure?source=${runId}`}
                    className="underline"
                  >
                    {configurations('create')}
                  </Link>
                </>
              )}
            </>
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <p role="status">
          {planning(
            `status.${run.status as 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'}`,
          )}
        </p>
        <PlanningRefresh active={active} label={planning('refresh')} />
        {active && isEditorRole(context.role) && (
          <CancelPlanningRun
            organizationId={context.active.id}
            runId={runId}
            label={planning('cancel')}
          />
        )}
      </div>
      {run.status === 'failed' && <p>{planning('failedNote')}</p>}
      {evidence && (
        <>
          <p>
            {t('fixedInputs', {
              cutoff: evidence.policy.cutoff,
              lead: evidence.policy.lead_time,
              review: evidence.policy.review_interval,
              maximum: evidence.policy.maximum,
              unit: evidence.policy.unit,
            })}{' '}
            · {evidence.policy.item_code}
          </p>
          {comparison ? (
            <PolicySensitivityReport
              evidence={comparison}
              selected={firstParam((await searchParams).variant)}
            />
          ) : (
            original && <PolicySimulationReport evidence={original} />
          )}
        </>
      )}
    </div>
  )
}
