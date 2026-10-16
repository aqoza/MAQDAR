import Form from 'next/form'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { DemandUnitEvidence } from '@/components/demand-unit-evidence'
import { StockPoolReport } from '@/components/stock-pool-report'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { comparisonParams, comparisonSchema } from '@/lib/stock-comparison'
import { formatScore } from '@/lib/forecast-quality'
import type { RawSearchParams } from '@/lib/master-data/list-params'

export default async function StockComparison({
  params,
  searchParams,
}: {
  params: Promise<{ policyId: string }>
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { policyId } = await params
  if (!z.uuid().safeParse(policyId).success) notFound()
  const [db, t, locale, raw] = await Promise.all([
    createClient(),
    getTranslations('StockComparison'),
    getLocale(),
    searchParams,
  ])
  const policy = await db
    .from('policy_workbench')
    .select('id,item_code,location_code,to_date,run_id')
    .eq('organization_id', context.active.id)
    .eq('id', policyId)
    .maybeSingle()
  if (policy.error) throw new Error('Policy unavailable')
  if (!policy.data) notFound()
  const chosen = comparisonParams(raw)
  let report: z.infer<typeof comparisonSchema> | null = null
  if (chosen.success) {
    const { data, error } = await db.rpc('policy_stock_comparison', {
      p_organization_id: context.active.id,
      p_policy_id: policyId,
      p_day: chosen.data.day,
      p_basis: chosen.data.basis,
      ...(chosen.data.override ? { p_override_id: chosen.data.override } : {}),
    })
    if (error?.code === 'MQ404') notFound()
    if (error) throw new Error('Stock comparison unavailable')
    report = comparisonSchema.parse(data)
  }
  const back = `/forecasts/workbench/${policyId}`
  const amount = (v: string | null | undefined) => formatScore(v, locale)
  const snapshot = report?.snapshot
  return (
    <div className="space-y-5">
      <Link href={back} className="underline">
        {t('back')}
      </Link>
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p>
        {policy.data.item_code} · {policy.data.location_code}
      </p>
      <p>{t('description')}</p>
      <p>{t('cutoff', { date: policy.data.to_date ?? '—' })}</p>
      <Form
        action={`${back}/stock`}
        className="flex flex-wrap items-end gap-3"
        key={JSON.stringify(raw)}
      >
        <label className="grid gap-1">
          {t('day')}
          <input
            type="date"
            name="day"
            required
            defaultValue={chosen.success ? chosen.data.day : (policy.data.to_date ?? '')}
            className="rounded-md border bg-background p-2"
          />
        </label>
        <label className="grid gap-1">
          {t('basis')}
          <select
            name="basis"
            required
            defaultValue={chosen.success ? chosen.data.basis : ''}
            className="rounded-md border bg-background p-2"
          >
            <option value="" disabled>
              {t('choose')}
            </option>
            {!report?.override_id && <option value="calculated">{t('calculated')}</option>}
            {report?.override_id && (
              <option value="approved">{t('approved', { revision: report.revision! })}</option>
            )}
          </select>
        </label>
        {report?.override_id && <input type="hidden" name="override" value={report.override_id} />}
        <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
          {t('compare')}
        </button>
      </Form>
      <p className="text-sm">
        <Link href={back} className="underline">
          {t('chooseRevision')}
        </Link>
      </p>
      {!chosen.success && (
        <p role="status">{Object.keys(raw).length ? t('invalid') : t('choose')}</p>
      )}
      {report && (
        <section className="space-y-4" aria-label={t('result')}>
          <h2 className="text-xl font-semibold">{t('result')}</h2>
          <p role="status">{t(`statuses.${report.status}`)}</p>
          <p>
            {report.basis === 'approved'
              ? t('approved', { revision: report.revision! })
              : t('calculated')}{' '}
            · {amount(report.maximum)} {report.unit ?? '—'}
          </p>
          <DemandUnitEvidence evidence={report.unit_provenance} />
          <p>{t(report.pool ? 'pool.formula' : 'formula')}</p>
          {report.status === 'available' && (
            <div className="rounded-xl border p-5">
              <p className="text-3xl font-semibold tabular-nums">
                {amount(report.quantity_above)} {report.unit}
              </p>
              {snapshot && (
                <p>
                  {t('value', { value: amount(report.value_above), currency: snapshot.currency })}
                </p>
              )}
            </div>
          )}
          {report.pool && (
            <>
              <StockPoolReport pool={report.pool} unit={report.unit} locale={locale} />
              <details>
                <summary>{t('identity')}</summary>
                <p>{t('policyId', { id: report.policy_id })}</p>
                {report.override_id && <p>{t('overrideId', { id: report.override_id })}</p>}
              </details>
            </>
          )}
          {snapshot && (
            <>
              <p>
                {t('snapshot', {
                  date: snapshot.date,
                  age: snapshot.age,
                  unit: snapshot.unit ?? '—',
                })}
              </p>
              <dl className="grid grid-cols-2 gap-2 rounded-xl border p-4">
                {(['quantity', 'allocated', 'available', 'unit_cost'] as const).map((key) => (
                  <div key={key}>
                    <dt>{t(key)}</dt>
                    <dd className="tabular-nums">
                      {amount(snapshot[key])}
                      {key === 'unit_cost' ? ` ${snapshot.currency}` : ''}
                    </dd>
                  </div>
                ))}
              </dl>
              <details>
                <summary>{t('identity')}</summary>
                <p>{t('snapshotId', { id: snapshot.id, time: snapshot.updated_at })}</p>
                <p>{t('policyId', { id: report.policy_id })}</p>
                {report.override_id && <p>{t('overrideId', { id: report.override_id })}</p>}
              </details>
            </>
          )}
          <Link href={`/forecasts/policies/${report.run_id}`} className="inline-block underline">
            {t('evidence')}
          </Link>
        </section>
      )}
    </div>
  )
}
