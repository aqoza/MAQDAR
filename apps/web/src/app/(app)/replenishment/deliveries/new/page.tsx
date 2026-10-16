import { HelpDisclosure } from '@/components/help-disclosure'
import { PageHeader } from '@/components/page-header'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { DeliveryScenarioReport } from '@/components/delivery-scenario-report'
import { DeliveryScenarioSaveForm } from '@/components/delivery-scenario-save-form'
import { isEditorRole } from '@/lib/auth/roles'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import {
  deliveryScenarioInputSchema,
  deliveryScenarioParams,
  deliveryScenarioReportSchema,
} from '@/lib/delivery-scenarios'
import { supplierScenarioReportSchema } from '@/lib/supplier-scenarios'
import type { RawSearchParams } from '@/lib/master-data/list-params'

export default async function NewDeliveryScenario({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const [db, t, locale, messages, raw] = await Promise.all([
    createClient(),
    getTranslations('DeliveryScenarios'),
    getLocale(),
    getMessages(),
    searchParams,
  ])
  const values = deliveryScenarioParams(raw)
  const scenario = z.uuid().safeParse(values.scenario)
  if (!scenario.success) notFound()
  const source = await db
    .from('supplier_scenarios')
    .select('report')
    .eq('organization_id', context.active.id)
    .eq('id', scenario.data)
    .maybeSingle()
  if (source.error) throw new Error('Source scenario unavailable')
  if (!source.data) notFound()
  const saved = supplierScenarioReportSchema.parse(source.data.report)
  const parsed = deliveryScenarioInputSchema.safeParse(values)
  let report = null
  let invalid = values.requested !== undefined && !parsed.success
  if (parsed.success) {
    const { data, error } = await db.rpc('delivery_scenario_preview', {
      p_organization_id: context.active.id,
      p_supplier_scenario_id: scenario.data,
      p_requested_date: parsed.data.requested,
      p_calendars_confirmed: parsed.data.confirmed === 'true',
    })
    if (error?.code === 'MQ404') notFound()
    if (error?.code === 'MQ422') invalid = true
    else if (error) throw new Error('Delivery scenario unavailable')
    else report = deliveryScenarioReportSchema.parse(data)
  }
  return (
    <div className="space-y-5">
      <Link className="underline" href={`/replenishment/suppliers/${scenario.data}`}>
        {t('source')}
      </Link>
      <PageHeader title={t('new')} description={t('description')} />
      <p>
        {saved.source.item_code} · {saved.source.location_code} · {saved.requested_supplier_code} ·{' '}
        {t('cutoff', { date: saved.source.cutoff })}
      </p>
      <form
        action="/replenishment/deliveries/new"
        method="get"
        className="space-y-4 rounded-xl border p-4"
        key={JSON.stringify(values)}
      >
        <input type="hidden" name="scenario" value={scenario.data} />
        <label className="grid gap-1">
          {t('requested')}
          <input
            name="requested"
            type="date"
            required
            min={saved.source.cutoff}
            max="2100-12-31"
            defaultValue={values.requested ?? saved.source.cutoff}
            className="max-w-sm rounded-md border bg-background p-2"
          />
        </label>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            name="confirmed"
            value="true"
            defaultChecked={values.confirmed === 'true'}
            className="mt-1"
          />
          {t('confirmation')}
        </label>
        <HelpDisclosure>
          <p>{t('scenarioNote')}</p>
        </HelpDisclosure>
        <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
          {t('preview')}
        </button>
      </form>
      {invalid && <p role="alert">{t('invalid')}</p>}
      {report && (
        <>
          <DeliveryScenarioReport report={report} locale={locale} />
          {isEditorRole(context.role) && (
            <NextIntlClientProvider messages={{ DeliveryScenarios: messages.DeliveryScenarios }}>
              <DeliveryScenarioSaveForm
                key={report.fingerprint}
                organizationId={context.active.id}
                input={{
                  scenario: scenario.data,
                  requested: report.requested_date,
                  confirmed: report.calendars_confirmed ? 'true' : 'false',
                  fingerprint: report.fingerprint,
                  request_id: crypto.randomUUID(),
                }}
              />
            </NextIntlClientProvider>
          )}
        </>
      )}
    </div>
  )
}
