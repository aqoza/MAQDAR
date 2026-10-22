import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { RegionalDateReport } from '@/components/regional-date-report'
import { RegionalDateSaveForm } from '@/components/regional-date-save-form'
import { isEditorRole } from '@/lib/auth/roles'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { regionalSourcingReportSchema } from '@/lib/regional-sourcing'
import {
  regionalDateParams,
  regionalDateInputSchema,
  regionalDateReportSchema,
  regionalDateRpcInput,
  canSaveRegionalDates,
} from '@/lib/regional-dates'
import type { RawSearchParams } from '@/lib/master-data/list-params'

export default async function NewRegionalDates({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  if (!isEditorRole(context.role)) notFound()
  const [db, t, messages, raw] = await Promise.all([
    createClient(),
    getTranslations('RegionalDates'),
    getMessages(),
    searchParams,
  ])
  const values = regionalDateParams(raw)
  const draft = z.guid().safeParse(values.sourcing)
  if (!draft.success) notFound()
  const source = await db
    .from('regional_sourcing_scenarios')
    .select('report')
    .eq('organization_id', context.active.id)
    .eq('id', draft.data)
    .maybeSingle()
  if (source.error) throw new Error('Regional sourcing unavailable')
  if (!source.data) notFound()
  const saved = regionalSourcingReportSchema.parse(source.data.report)
  const region = await db
    .from('stock_regions')
    .select('id')
    .eq('organization_id', context.active.id)
    .eq('id', saved.region.id)
    .is('archived_at', null)
    .maybeSingle()
  if (region.error) throw new Error('Region unavailable')
  if (!region.data) notFound()
  const parsed = regionalDateInputSchema.safeParse(values)
  let report = null
  let invalid = values.requested !== undefined && !parsed.success
  if (parsed.success) {
    const { data, error } = await db.rpc('regional_date_preview', {
      p_organization_id: context.active.id,
      ...regionalDateRpcInput(parsed.data),
    })
    if (error?.code === 'MQ404') notFound()
    if (error?.code === 'MQ422') invalid = true
    else if (error) throw new Error('Regional dates unavailable')
    else report = regionalDateReportSchema.parse(data)
  }
  return (
    <div className="min-w-0 space-y-4 wrap-anywhere">
      <PageHeader
        pattern="replenishment"
        title={t('new')}
        description={`${saved.destination.policy?.item_code} · ${saved.destination.policy.location_code} · ${saved.destination.policy?.cutoff}`}
        help={
          <HelpDisclosure>
            <p>{t('method')}</p>
            <p>{t('noGuarantee')}</p>
          </HelpDisclosure>
        }
        back={
          <Link
            className="inline-block underline"
            href={`/replenishment/regional-stock/sourcing/${draft.data}`}
          >
            {t('source')}
          </Link>
        }
      />
      <form
        action="/replenishment/regional-stock/sourcing/dates/new"
        method="get"
        className="workspace-panel space-y-3"
        key={JSON.stringify(values)}
      >
        <input type="hidden" name="sourcing" value={draft.data} />
        <label className="grid min-w-0 gap-1">
          {t('requested')}
          <input
            type="date"
            name="requested"
            required
            min={saved.destination.policy?.cutoff}
            max="2100-12-31"
            defaultValue={values.requested ?? saved.destination.policy?.cutoff}
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
      {report && <RegionalDateReport report={report} />}
      {report &&
        parsed.success &&
        canSaveRegionalDates(report.status) &&
        isEditorRole(context.role) && (
          <NextIntlClientProvider messages={{ RegionalDates: messages.RegionalDates }}>
            <RegionalDateSaveForm
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
