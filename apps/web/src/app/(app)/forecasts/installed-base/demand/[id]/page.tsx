import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getFormatter, getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { InstalledBaseDemandReport } from '@/components/installed-base-demand-report'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'
import { installedDemandReportSchema } from '@/lib/installed-base-demand'

export default async function InstalledDemandScenario({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { id } = await params
  if (!z.guid().safeParse(id).success) notFound()
  const [db, t, messages, format] = await Promise.all([
    createClient(),
    getTranslations('InstalledBaseDemand'),
    getMessages(),
    getFormatter(),
  ])
  const { data, error } = await db
    .from('installed_base_demand_scenarios')
    .select('scenario_name,dataset_id,created_at,report')
    .eq('organization_id', context.active.id)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error('Demand scenario unavailable')
  if (!data) notFound()
  const report = installedDemandReportSchema.parse(data.report)
  const evaluationT = await getTranslations('InstalledBaseEvaluation')
  const source = await db
    .from('installed_base_datasets')
    .select('id')
    .eq('organization_id', context.active.id)
    .eq('id', data.dataset_id)
    .maybeSingle()
  if (source.error) throw new Error('Population source unavailable')
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="forecasts"
        title={data.scenario_name}
        description={t('savedAt', { time: format.dateTime(new Date(data.created_at), 'long') })}
        back={
          <Link href="/forecasts/installed-base/demand" className="underline">
            {t('title')}
          </Link>
        }
        actions={
          <>
            {isEditorRole(context.role) && (
              <Link href={`/forecasts/installed-base/demand/${id}/evaluate`} className="underline">
                {evaluationT('new')}
              </Link>
            )}
            <Link href="/forecasts/installed-base/evaluations" className="underline">
              {evaluationT('title')}
            </Link>
            {source.data && (
              <Link href={`/forecasts/installed-base/${data.dataset_id}`} className="underline">
                {t('population')}
              </Link>
            )}
            {source.data && isEditorRole(context.role) && (
              <Link
                href={`/forecasts/installed-base/${data.dataset_id}/demand`}
                className="underline"
              >
                {t('new')}
              </Link>
            )}
            <HelpDisclosure label={t('methodDetails')}>
              <p>{t('method')}</p>
              <p>{t('limits')}</p>
            </HelpDisclosure>
          </>
        }
      />
      {!source.data && <p className="text-sm text-muted-foreground">{t('sourceUnavailable')}</p>}
      <NextIntlClientProvider
        messages={{
          InstalledBaseDemand: messages.InstalledBaseDemand,
          InstalledBase: messages.InstalledBase,
        }}
      >
        <InstalledBaseDemandReport report={report} />
      </NextIntlClientProvider>
      <details className="min-w-0 workspace-panel text-sm">
        <summary className="min-h-11 cursor-pointer md:min-h-0">{t('savedEvidence')}</summary>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t('importTime')}</dt>
            <dd className="break-words text-xs">
              <bdi>{data.created_at}</bdi>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t('fingerprint')}</dt>
            <dd className="break-all text-xs">{report.fingerprint}</dd>
          </div>
        </dl>
        <p className="mt-3">{t('immutable')}</p>
      </details>
    </div>
  )
}
