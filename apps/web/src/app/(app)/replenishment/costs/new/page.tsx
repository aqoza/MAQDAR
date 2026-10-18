import { PageHeader } from '@/components/page-header'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PurchaseCostReport } from '@/components/purchase-cost-report'
import { PurchaseCostSaveForm } from '@/components/purchase-cost-save-form'
import { isEditorRole } from '@/lib/auth/roles'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import {
  purchaseCostInputSchema,
  purchaseCostParams,
  purchaseCostReportSchema,
} from '@/lib/purchase-costs'
import { deliveryScenarioReportSchema } from '@/lib/delivery-scenarios'
import type { RawSearchParams } from '@/lib/master-data/list-params'

export default async function NewPurchaseCost({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const [db, t, locale, messages, raw] = await Promise.all([
    createClient(),
    getTranslations('PurchaseCosts'),
    getLocale(),
    getMessages(),
    searchParams,
  ])
  const values = purchaseCostParams(raw)
  const delivery = z.guid().safeParse(values.delivery)
  if (!delivery.success) notFound()
  const source = await db
    .from('delivery_scenarios')
    .select('report')
    .eq('organization_id', context.active.id)
    .eq('id', delivery.data)
    .maybeSingle()
  if (source.error) throw new Error('Source delivery unavailable')
  if (!source.data) notFound()
  const saved = deliveryScenarioReportSchema.parse(source.data.report)
  const parsed = purchaseCostInputSchema.safeParse(values)
  let report = null
  let invalid = !parsed.success
  if (parsed.success) {
    const { data, error } = await db.rpc('purchase_cost_preview', {
      p_organization_id: context.active.id,
      p_delivery_id: delivery.data,
      p_price_confirmed: parsed.data.confirmed === 'true',
    })
    if (error?.code === 'MQ404') notFound()
    if (error?.code === 'MQ422') invalid = true
    else if (error) throw new Error('Purchase cost unavailable')
    else report = purchaseCostReportSchema.parse(data)
  }
  return (
    <div className="space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('new')}
        description={t('description')}
        back={
          <Link className="underline" href={`/replenishment/deliveries/${delivery.data}`}>
            {t('source')}
          </Link>
        }
      />
      <p>
        {saved.source.item_code} · {saved.source.location_code} · {saved.source.supplier_code}
      </p>
      {report && <PurchaseCostReport report={report} locale={locale} />}
      <form
        action="/replenishment/costs/new"
        method="get"
        className="space-y-4 workspace-panel"
        key={JSON.stringify(values)}
      >
        <input type="hidden" name="delivery" value={delivery.data} />
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
        <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
          {t('preview')}
        </button>
      </form>
      {invalid && <p role="alert">{t('invalid')}</p>}
      {report && isEditorRole(context.role) && (
        <NextIntlClientProvider messages={{ PurchaseCosts: messages.PurchaseCosts }}>
          <PurchaseCostSaveForm
            key={report.fingerprint}
            organizationId={context.active.id}
            input={{
              delivery: delivery.data,
              confirmed: report.price_confirmed ? 'true' : 'false',
              fingerprint: report.fingerprint,
              request_id: crypto.randomUUID(),
            }}
          />
        </NextIntlClientProvider>
      )}
    </div>
  )
}
