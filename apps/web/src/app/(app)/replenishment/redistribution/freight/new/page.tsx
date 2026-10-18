import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { TransferFreightReport } from '@/components/transfer-freight-report'
import { TransferFreightSaveForm } from '@/components/transfer-freight-save-form'
import { isEditorRole } from '@/lib/auth/roles'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { transferDateReportSchema } from '@/lib/transfer-dates'
import {
  transferFreightParams,
  transferFreightInputSchema,
  transferFreightReportSchema,
  transferFreightRpcInput,
  canSaveTransferFreight,
} from '@/lib/transfer-freight'
import type { RawSearchParams } from '@/lib/master-data/list-params'

export default async function NewTransferFreight({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const [db, t, locale, messages, raw] = await Promise.all([
    createClient(),
    getTranslations('TransferFreight'),
    getLocale(),
    getMessages(),
    searchParams,
  ])
  const values = transferFreightParams(raw)
  const draft = z.guid().safeParse(values.scenario)
  if (!draft.success) notFound()
  const source = await db
    .from('transfer_date_scenarios')
    .select('report')
    .eq('organization_id', context.active.id)
    .eq('id', draft.data)
    .maybeSingle()
  if (source.error) throw new Error('Transfer date scenario unavailable')
  if (!source.data) notFound()
  const saved = transferDateReportSchema.parse(source.data.report)
  const parsed = transferFreightInputSchema.safeParse(values)
  let report = null
  let invalid = !parsed.success
  if (parsed.success) {
    const { data, error } = await db.rpc('transfer_freight_preview', {
      p_organization_id: context.active.id,
      ...transferFreightRpcInput(parsed.data),
    })
    if (error?.code === 'MQ404') notFound()
    if (error?.code === 'MQ422') invalid = true
    else if (error) throw new Error('Freight preview unavailable')
    else report = transferFreightReportSchema.parse(data)
  }
  return (
    <div className="min-w-0 space-y-4 wrap-anywhere">
      <PageHeader
        pattern="replenishment"
        title={t('new')}
        description={`${saved.source.destination.policy.item_code} · ${saved.source.source_location_code} → ${saved.source.destination.policy.location_code}`}
        help={
          <HelpDisclosure>
            <p>{t('method')}</p>
            <p>{t('noGuarantee')}</p>
          </HelpDisclosure>
        }
        back={
          <Link
            className="inline-block underline"
            href={`/replenishment/redistribution/dates/${draft.data}`}
          >
            {t('source')}
          </Link>
        }
      />
      <form
        action="/replenishment/redistribution/freight/new"
        method="get"
        className="workspace-panel space-y-3"
        key={JSON.stringify(values)}
      >
        <input type="hidden" name="scenario" value={draft.data} />
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
      {report && <TransferFreightReport report={report} locale={locale} />}
      {report &&
        parsed.success &&
        canSaveTransferFreight(report.status) &&
        isEditorRole(context.role) && (
          <NextIntlClientProvider messages={{ TransferFreight: messages.TransferFreight }}>
            <TransferFreightSaveForm
              key={report.fingerprint}
              organizationId={context.active.id}
              input={{
                ...parsed.data,
                request_id: crypto.randomUUID(),
                fingerprint: report.fingerprint,
              }}
            />
          </NextIntlClientProvider>
        )}
    </div>
  )
}
