import { PageHeader } from '@/components/page-header'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, getTranslations } from 'next-intl/server'
import { ReplenishmentReport } from '@/components/replenishment-report'
import { ReplenishmentSaveForm } from '@/components/replenishment-save-form'
import { isEditorRole } from '@/lib/auth/roles'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import {
  draftInputSchema,
  draftParams,
  draftSelectionSchema,
  replenishmentReportSchema,
} from '@/lib/replenishment'
import type { RawSearchParams } from '@/lib/master-data/list-params'

export default async function NewDraft({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const [db, t, locale, messages, raw] = await Promise.all([
    createClient(),
    getTranslations('Replenishment'),
    getLocale(),
    getMessages(),
    searchParams,
  ])
  const values = draftParams(raw)
  const selection = draftSelectionSchema.safeParse(values)
  if (!selection.success)
    return (
      <div className="space-y-4">
        <h1 className="text-page-title">{t('new')}</h1>
        <p>{t('choosePolicy')}</p>
        <Link className="underline" href="/forecasts/workbench">
          {t('policies')}
        </Link>
      </div>
    )
  const v = selection.data
  const policy = await db
    .from('policy_workbench')
    .select('id,item_code,location_code,to_date')
    .eq('organization_id', context.active.id)
    .eq('id', v.policy)
    .maybeSingle()
  if (policy.error) throw new Error('Policy unavailable')
  if (!policy.data) notFound()
  const parsed = draftInputSchema.safeParse(values)
  let report = null
  if (parsed.success) {
    const { data, error } = await db.rpc('replenishment_preview', {
      p_organization_id: context.active.id,
      p_policy_id: v.policy,
      p_basis: v.basis,
      ...(v.override ? { p_override_id: v.override } : {}),
      p_backorders: parsed.data.backorders,
      p_orders_confirmed: parsed.data.confirmed === 'true',
    })
    if (error?.code === 'MQ404') notFound()
    if (error) throw new Error('Replenishment preview unavailable')
    report = replenishmentReportSchema.parse(data)
  }
  return (
    <div className="space-y-4">
      <Link className="underline" href="/replenishment">
        {t('back')}
      </Link>
      <PageHeader title={t('new')} description={t('description')} />
      <p>
        {policy.data.item_code} · {policy.data.location_code} ·{' '}
        {t('cutoff', { date: policy.data.to_date ?? '—' })}
      </p>
      <p>{v.basis === 'calculated' ? t('calculated') : t('chosenApproved')}</p>
      <Link className="underline" href={`/forecasts/workbench/${v.policy}`}>
        {t('changeBasis')}
      </Link>
      <form
        action="/replenishment/new"
        method="get"
        className="space-y-4 workspace-panel"
        key={JSON.stringify(values)}
      >
        <input type="hidden" name="policy" value={v.policy} />
        <input type="hidden" name="basis" value={v.basis} />
        {v.override && <input type="hidden" name="override" value={v.override} />}
        <label className="grid gap-1">
          {t('backorders')}
          <input
            name="backorders"
            inputMode="decimal"
            required
            maxLength={40}
            defaultValue={values.backorders ?? ''}
            aria-describedby="backorder-help"
            className="max-w-sm rounded-md border bg-background p-2"
          />
        </label>
        <p id="backorder-help" className="text-sm text-muted-foreground">
          {t('backordersNote')}
        </p>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            name="confirmed"
            value="true"
            defaultChecked={values.confirmed === 'true'}
            className="mt-1"
          />
          {t('confirmation', { date: policy.data.to_date ?? '—' })}
        </label>
        <p className="text-sm text-muted-foreground">{t('asOfNote')}</p>
        <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
          {t('preview')}
        </button>
      </form>
      {!parsed.success && values.backorders !== undefined && <p role="alert">{t('invalid')}</p>}
      {report && (
        <>
          <ReplenishmentReport report={report} locale={locale} />
          {isEditorRole(context.role) && (
            <NextIntlClientProvider messages={{ Replenishment: messages.Replenishment }}>
              <ReplenishmentSaveForm
                key={report.fingerprint}
                organizationId={context.active.id}
                input={{
                  policy: v.policy,
                  basis: v.basis,
                  override: v.override,
                  request_id: crypto.randomUUID(),
                  backorders: report.backorders,
                  confirmed: report.orders_confirmed ? 'true' : 'false',
                  fingerprint: report.fingerprint,
                }}
              />
            </NextIntlClientProvider>
          )}
        </>
      )}
    </div>
  )
}
