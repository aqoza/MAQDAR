import Link from 'next/link'
import { randomUUID } from 'node:crypto'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { InstalledBaseEvaluationForm } from '@/components/installed-base-evaluation-form'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'
import { installedDemandReportSchema } from '@/lib/installed-base-demand'

export default async function CreateInstalledEvaluation({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  if (!isEditorRole(context.role)) notFound()
  const { id } = await params
  if (!z.guid().safeParse(id).success) notFound()
  const [db, t, messages] = await Promise.all([
    createClient(),
    getTranslations('InstalledBaseEvaluation'),
    getMessages(),
  ])
  const { data, error } = await db
    .from('installed_base_demand_scenarios')
    .select('scenario_name,report')
    .eq('organization_id', context.active.id)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error('Demand scenario unavailable')
  if (!data) notFound()
  const scenario = installedDemandReportSchema.parse(data.report)
  const end = scenario.days.at(-1)!.date
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: scenario.source.population.source.time_zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  const completed = end < today
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="forecasts"
        title={t('new')}
        description={data.scenario_name}
        back={
          <Link href={`/forecasts/installed-base/demand/${id}`} className="underline">
            {t('scenario')}
          </Link>
        }
        actions={
          <>
            <Link href="/forecasts/installed-base/evaluations" className="underline">
              {t('title')}
            </Link>
            <HelpDisclosure label={t('methodDetails')}>
              <p>{t('method')}</p>
              <p>{t('limits')}</p>
            </HelpDisclosure>
          </>
        }
      />
      <p className="workspace-panel text-evidence-value">
        <bdi>
          {scenario.source.population.input.item_code} ·{' '}
          {scenario.source.population.input.location_code} · {scenario.source.population.input.unit}{' '}
          · {scenario.days[0].date} – {end}
        </bdi>
      </p>
      {completed ? (
        <NextIntlClientProvider
          messages={{
            InstalledBaseEvaluation: messages.InstalledBaseEvaluation,
            InstalledBaseDemand: messages.InstalledBaseDemand,
            InstalledBase: messages.InstalledBase,
          }}
        >
          <InstalledBaseEvaluationForm
            organizationId={context.active.id}
            scenarioId={id}
            requestId={randomUUID()}
          />
        </NextIntlClientProvider>
      ) : (
        <p role="status" className="workspace-panel">
          {t('incomplete')}
        </p>
      )}
    </div>
  )
}
