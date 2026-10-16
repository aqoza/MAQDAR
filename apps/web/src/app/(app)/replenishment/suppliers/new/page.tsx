import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { SupplierScenarioReport } from '@/components/supplier-scenario-report'
import { SupplierScenarioSaveForm } from '@/components/supplier-scenario-save-form'
import { isEditorRole } from '@/lib/auth/roles'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import {
  supplierScenarioInputSchema,
  supplierScenarioParams,
  supplierScenarioReportSchema,
} from '@/lib/supplier-scenarios'
import type { RawSearchParams } from '@/lib/master-data/list-params'

export default async function NewSupplierScenario({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const [db, t, locale, messages, raw] = await Promise.all([
    createClient(),
    getTranslations('SupplierScenarios'),
    getLocale(),
    getMessages(),
    searchParams,
  ])
  const values = supplierScenarioParams(raw)
  const draft = z.uuid().safeParse(values.draft)
  if (!draft.success) notFound()
  const source = await db
    .from('replenishment_draft_list')
    .select('id,item_code,location_code,cutoff,status')
    .eq('organization_id', context.active.id)
    .eq('id', draft.data)
    .maybeSingle()
  if (source.error) throw new Error('Draft unavailable')
  if (!source.data) notFound()
  const parsed = supplierScenarioInputSchema.safeParse(values)
  let report = null
  if (parsed.success) {
    const { data, error } = await db.rpc('supplier_scenario_preview', {
      p_organization_id: context.active.id,
      p_draft_id: draft.data,
      p_supplier_code: parsed.data.supplier,
      p_terms_confirmed: parsed.data.confirmed === 'true',
    })
    if (error?.code === 'MQ404') notFound()
    if (error) throw new Error('Supplier scenario unavailable')
    report = supplierScenarioReportSchema.parse(data)
  }
  return (
    <div className="space-y-5">
      <Link className="underline" href={`/replenishment/${draft.data}`}>
        {t('source')}
      </Link>
      <h1 className="text-2xl font-semibold">{t('new')}</h1>
      <p>{t('description')}</p>
      <p>
        {source.data.item_code} · {source.data.location_code} ·{' '}
        {t('cutoff', { date: source.data.cutoff ?? '—' })}
      </p>
      <Link
        className="inline-block underline"
        href={`/suppliers/supplier-items?q=${encodeURIComponent(source.data.item_code ?? '')}`}
      >
        {t('findTerms')}
      </Link>
      <form
        action="/replenishment/suppliers/new"
        method="get"
        className="space-y-4 rounded-xl border p-4"
        key={JSON.stringify(values)}
      >
        <input type="hidden" name="draft" value={draft.data} />
        <label className="grid gap-1">
          {t('supplier')}
          <input
            name="supplier"
            required
            maxLength={64}
            defaultValue={values.supplier ?? ''}
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
          {t('confirmation', { date: source.data.cutoff ?? '—' })}
        </label>
        <p className="text-sm text-muted-foreground">{t('scenarioNote')}</p>
        <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
          {t('preview')}
        </button>
      </form>
      {!parsed.success && values.supplier !== undefined && <p role="alert">{t('invalid')}</p>}
      {report && (
        <>
          <SupplierScenarioReport report={report} locale={locale} />
          {isEditorRole(context.role) && (
            <NextIntlClientProvider messages={{ SupplierScenarios: messages.SupplierScenarios }}>
              <SupplierScenarioSaveForm
                key={report.fingerprint}
                organizationId={context.active.id}
                input={{
                  draft: draft.data,
                  supplier: report.requested_supplier_code,
                  confirmed: report.terms_confirmed ? 'true' : 'false',
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
