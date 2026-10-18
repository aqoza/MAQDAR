import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { TransferDateReport } from '@/components/transfer-date-report'
import { TransferDateSaveForm } from '@/components/transfer-date-save-form'
import { isEditorRole } from '@/lib/auth/roles'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { redistributionReportSchema } from '@/lib/redistribution'
import {
  transferDateParams,
  transferDateInputSchema,
  transferDateReportSchema,
  transferDateRpcInput,
  canSaveTransferDates,
} from '@/lib/transfer-dates'
import type { RawSearchParams } from '@/lib/master-data/list-params'

export default async function NewTransferDates({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const [db, t, locale, messages, raw] = await Promise.all([
    createClient(),
    getTranslations('TransferDates'),
    getLocale(),
    getMessages(),
    searchParams,
  ])
  const values = transferDateParams(raw)
  const draft = z.guid().safeParse(values.draft)
  if (!draft.success) notFound()
  const source = await db
    .from('redistribution_drafts')
    .select('report')
    .eq('organization_id', context.active.id)
    .eq('id', draft.data)
    .maybeSingle()
  if (source.error) throw new Error('Redistribution draft unavailable')
  if (!source.data) notFound()
  const saved = redistributionReportSchema.parse(source.data.report)
  const parsed = transferDateInputSchema.safeParse(values)
  let report = null
  let invalid = values.requested !== undefined && !parsed.success
  if (parsed.success) {
    const { data, error } = await db.rpc('transfer_date_preview', {
      p_organization_id: context.active.id,
      ...transferDateRpcInput(parsed.data),
    })
    if (error?.code === 'MQ404') notFound()
    if (error?.code === 'MQ422') invalid = true
    else if (error) throw new Error('Transfer dates unavailable')
    else report = transferDateReportSchema.parse(data)
  }
  return (
    <div className="min-w-0 space-y-4 wrap-anywhere">
      <PageHeader
        pattern="replenishment"
        title={t('new')}
        description={`${saved.destination.policy.item_code} · ${saved.source_location_code} → ${saved.destination.policy.location_code}`}
        help={
          <HelpDisclosure>
            <p>{t('method')}</p>
            <p>{t('noGuarantee')}</p>
          </HelpDisclosure>
        }
        back={
          <Link
            className="inline-block underline"
            href={`/replenishment/redistribution/${draft.data}`}
          >
            {t('source')}
          </Link>
        }
      />
      <form
        action="/replenishment/redistribution/dates/new"
        method="get"
        className="workspace-panel space-y-3"
        key={JSON.stringify(values)}
      >
        <input type="hidden" name="draft" value={draft.data} />
        <label className="grid min-w-0 gap-1">
          {t('requested')}
          <input
            type="date"
            name="requested"
            required
            min={saved.destination.policy.cutoff}
            max="2100-12-31"
            defaultValue={values.requested ?? saved.destination.policy.cutoff}
            className="w-full min-w-0 rounded-md border bg-background p-2 sm:max-w-xs"
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
        <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
          {t('preview')}
        </button>
      </form>
      {invalid && <p role="alert">{t('invalid')}</p>}
      {report && <TransferDateReport report={report} locale={locale} />}
      {report &&
        parsed.success &&
        canSaveTransferDates(report.status) &&
        isEditorRole(context.role) && (
          <NextIntlClientProvider messages={{ TransferDates: messages.TransferDates }}>
            <TransferDateSaveForm
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
