import Link from 'next/link'
import { HelpDisclosure } from '@/components/help-disclosure'
import { DemandUnitEvidence } from '@/components/demand-unit-evidence'
import { notFound, redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { policyEvidenceSchema } from '@/lib/inventory-policy'

export default async function PolicyResult({ params }: { params: Promise<{ runId: string }> }) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { runId } = await params
  if (!z.uuid().safeParse(runId).success) notFound()
  const [db, t, locale] = await Promise.all([
    createClient(),
    getTranslations('InventoryPolicy'),
    getLocale(),
  ])
  const { data: run, error: runError } = await db
    .from('planning_runs')
    .select('kind,status,locations(code)')
    .eq('organization_id', context.active.id)
    .eq('id', runId)
    .maybeSingle()
  if (runError) throw new Error('Policy run unavailable')
  if (!run || run.kind !== 'policy') notFound()
  if (run.status !== 'succeeded') redirect('/forecasts')
  const { data, error } = await db
    .from('inventory_policies')
    .select('id,item_code,unit,evidence')
    .eq('organization_id', context.active.id)
    .eq('run_id', runId)
    .maybeSingle()
  if (error) throw new Error('Policy result unavailable')
  if (!data) notFound()
  const parsed = policyEvidenceSchema.safeParse(data.evidence)
  if (!parsed.success) throw new Error('Invalid policy evidence')
  const { output, forecast, options } = parsed.data
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 })
  const number = (value: string | number) => formatter.format(value as number)
  return (
    <div className="space-y-4">
      <Link href="/forecasts" className="text-sm underline">
        {t('back')}
      </Link>
      <h1 className="text-page-title">{t('title')}</h1>
      <Link href={`/forecasts/workbench/${data.id}`} className="inline-block underline">
        {t('reviewPolicy')}
      </Link>
      <p>
        {data.item_code} · {run.locations?.code} · {data.unit ?? t('itemUnits')}
      </p>
      <p>{t('asOf', { date: forecast.to_date })}</p>
      <p>
        {t('inputs', {
          lead: options.lead_time,
          review: options.review_interval,
          service: number(Number(options.service_level) * 100),
        })}
      </p>
      <HelpDisclosure>
        <p>{t('assumptions')}</p>
        <p>{t('rulesNote')}</p>
        {forecast.method === 'regional-v1' && <p>{t('groupNote')}</p>}
      </HelpDisclosure>
      {forecast.method !== 'regional-v1' && (
        <DemandUnitEvidence evidence={forecast.source?.unit_provenance} />
      )}
      <p role="status">{t(`statuses.${output.status}`)}</p>
      {output.lead_time && output.protection && (
        <div className="workspace-table overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="text-start font-semibold">{t('thresholds')}</caption>
            <thead>
              <tr>
                {(['period', 'days', 'forecast', 'quantile', 'safetyStock', 'target'] as const).map(
                  (key) => (
                    <th className="p-2 text-start" key={key}>
                      {t(key)}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {(['lead_time', 'protection'] as const).map((key) => {
                const row = output[key]!
                return (
                  <tr className="border-t" key={key}>
                    <th className="p-2 text-start">{t(key)}</th>
                    {[row.days, row.forecast, row.quantile, row.safety_stock, row.target].map(
                      (value, i) => (
                        <td className="p-2 tabular-nums" key={i}>
                          {number(value)}
                        </td>
                      ),
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p>
        {t('evidenceCounts', {
          residuals: output.residual_count,
          positive: output.positive_days,
          samples: output.samples,
        })}
      </p>
      <Link
        className="underline"
        href={`/forecasts/results/${forecast.run_id}?item=${forecast.item_id}`}
      >
        {t('sourceLink')}
      </Link>
      <details>
        <summary className="cursor-pointer">{t('points')}</summary>
        <table className="w-full text-sm">
          <caption className="sr-only">{t('points')}</caption>
          <thead>
            <tr>
              <th className="p-2 text-start">{t('date')}</th>
              <th className="p-2 text-start">{t('forecast')}</th>
            </tr>
          </thead>
          <tbody>
            {forecast.output.forecast.map((d) => (
              <tr key={d.date} className="border-t">
                <td className="p-2">{d.date}</td>
                <td className="p-2">{number(d.quantity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      {!!output.calibration.length && (
        <details>
          <summary className="cursor-pointer">{t('calibration')}</summary>
          <p>{t('calibrationNote')}</p>
          <div className="workspace-table overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{t('calibration')}</caption>
              <thead>
                <tr>
                  {(['date', 'trainTo', 'actual', 'prediction', 'error'] as const).map((k) => (
                    <th className="p-2 text-start" key={k}>
                      {t(k)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {output.calibration.map((d) => (
                  <tr key={d.date} className="border-t">
                    <td className="p-2">{d.date}</td>
                    <td className="p-2">{d.train_to}</td>
                    {[d.actual, d.prediction, d.error].map((v, i) => (
                      <td className="p-2 tabular-nums" key={i}>
                        {number(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  )
}
