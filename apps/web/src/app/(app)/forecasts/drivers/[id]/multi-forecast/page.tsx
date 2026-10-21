import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { MultiDriverForecastForm } from '@/components/multi-driver-forecast-form'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'
import { driverReportSchema } from '@/lib/external-drivers'

export default async function NewMultiDriverForecast({
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
    getTranslations('MultiDriverForecast'),
    getMessages(),
  ])
  const { data, error } = await db
    .from('external_driver_datasets')
    .select('report')
    .eq('organization_id', context.active.id)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error('Driver dataset unavailable')
  if (!data) notFound()
  const report = driverReportSchema.parse(data.report)
  const horizon =
    (Date.parse(report.input.forecast_to) - Date.parse(report.input.cutoff)) / 86400000
  const { data: rows, error: sourceError } = await db
    .from('forecast_results')
    .select(
      'id,run_id,model,planning_runs!inner(from_date,to_date,status,kind,options,finished_at)',
    )
    .eq('organization_id', context.active.id)
    .eq('location_id', report.source.location_id)
    .eq('item_id', report.source.item_id)
    .eq('status', 'selected')
    .eq('planning_runs.status', 'succeeded')
    .eq('planning_runs.kind', 'forecast')
    .eq('planning_runs.from_date', report.input.history_from)
    .eq('planning_runs.to_date', report.input.cutoff)
    .in('planning_runs.options->>method', ['baseline-v1', 'expanded-v1'])
    .eq('planning_runs.options->>horizon', String(horizon))
    .eq('evidence->source->unit_provenance->>status', 'consistent')
    .order('id', { ascending: false })
    .limit(100)
  if (sourceError) throw new Error('Source forecasts unavailable')
  const { data: candidates, error: candidatesError } = await db
    .from('external_driver_datasets')
    .select('id,driver_name,driver_unit:report->input->>unit,created_at')
    .eq('organization_id', context.active.id)
    .eq('item_id', report.source.item_id)
    .eq('location_id', report.source.location_id)
    .eq('report->input->>history_from', report.input.history_from)
    .eq('report->input->>cutoff', report.input.cutoff)
    .eq('report->input->>forecast_to', report.input.forecast_to)
    .neq('id', id)
    .order('created_at', { ascending: false })
    .order('id')
    .limit(100)
  if (candidatesError) throw new Error('Matching driver datasets unavailable')
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="forecasts"
        title={t('title')}
        description={`${report.source.item_code} · ${report.source.location_code} · ${report.input.driver_name}`}
        back={
          <Link className="underline" href={`/forecasts/drivers/${id}`}>
            {t('dataset')}
          </Link>
        }
        actions={
          <HelpDisclosure label={t('methodDetails')}>
            <p>{t('method')}</p>
            <p>{t('uncertainty')}</p>
          </HelpDisclosure>
        }
      />
      <div className="workspace-panel grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <p className="text-xs text-muted-foreground">{t('history')}</p>
          <p className="text-evidence-value">
            <bdi>
              {report.input.history_from} – {report.input.cutoff}
            </bdi>
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t('horizon')}</p>
          <p className="text-evidence-value">{horizon}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t('driverUnit')}</p>
          <p className="text-evidence-value">
            <bdi>{report.input.unit}</bdi>
          </p>
        </div>
      </div>
      <NextIntlClientProvider messages={{ MultiDriverForecast: messages.MultiDriverForecast }}>
        <MultiDriverForecastForm
          organizationId={context.active.id}
          datasetId={id}
          datasets={(candidates ?? []).map((d) => ({
            id: d.id,
            label: `${d.driver_name} · ${d.driver_unit} · ${d.created_at} · ${d.id}`,
          }))}
          requestId={crypto.randomUUID()}
          forecasts={(rows ?? []).map((r) => ({
            id: r.id,
            label: `${r.planning_runs.finished_at?.slice(0, 10)} · ${r.run_id}`,
          }))}
        />
      </NextIntlClientProvider>
    </div>
  )
}
