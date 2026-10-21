import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getFormatter, getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { InstalledBaseEvaluationReport } from '@/components/installed-base-evaluation-report'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { installedEvaluationReportSchema } from '@/lib/installed-base-evaluation'

export default async function InstalledEvaluationDetail({
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
    getTranslations('InstalledBaseEvaluation'),
    getMessages(),
    getFormatter(),
  ])
  const { data, error } = await db
    .from('installed_base_evaluations')
    .select('evaluation_name,scenario_id,created_at,report')
    .eq('organization_id', context.active.id)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error('Demand scenario unavailable')
  if (!data) notFound()
  const report = installedEvaluationReportSchema.parse(data.report)
  const source = await db
    .from('installed_base_demand_scenarios')
    .select('id')
    .eq('organization_id', context.active.id)
    .eq('id', data.scenario_id)
    .maybeSingle()
  if (source.error) throw new Error('Population source unavailable')
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="forecasts"
        title={data.evaluation_name}
        description={t('savedAt', { time: format.dateTime(new Date(data.created_at), 'long') })}
        back={
          <Link href="/forecasts/installed-base/evaluations" className="underline">
            {t('title')}
          </Link>
        }
        actions={
          <>
            {source.data && (
              <Link
                href={`/forecasts/installed-base/demand/${data.scenario_id}`}
                className="underline"
              >
                {t('scenario')}
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
          InstalledBaseEvaluation: messages.InstalledBaseEvaluation,
          InstalledBase: messages.InstalledBase,
        }}
      >
        <InstalledBaseEvaluationReport report={report} />
      </NextIntlClientProvider>
      <details className="min-w-0 workspace-panel text-sm">
        <summary className="min-h-11 cursor-pointer text-subsection-title md:min-h-0">
          {t('savedEvidence')}
        </summary>
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
