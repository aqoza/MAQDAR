import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { NetworkDateReport } from '@/components/network-date-report'
import { NetworkDateSaveForm } from '@/components/network-date-save-form'
import { isEditorRole } from '@/lib/auth/roles'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { networkReportSchema } from '@/lib/network-allocation'
import {
  networkDateParams,
  networkDateInputSchema,
  networkDateReportSchema,
  networkDateRpcInput,
  canSaveNetworkDates,
} from '@/lib/network-dates'
import type { RawSearchParams } from '@/lib/master-data/list-params'

export default async function NewNetworkDates({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const [db, t, locale, messages, raw] = await Promise.all([
    createClient(),
    getTranslations('NetworkDates'),
    getLocale(),
    getMessages(),
    searchParams,
  ])
  const values = networkDateParams(raw)
  const draft = z.guid().safeParse(values.allocation)
  if (!draft.success) notFound()
  const source = await db
    .from('network_allocation_scenarios')
    .select('report')
    .eq('organization_id', context.active.id)
    .eq('id', draft.data)
    .maybeSingle()
  if (source.error) throw new Error('Network allocation unavailable')
  if (!source.data) notFound()
  const saved = networkReportSchema.parse(source.data.report)
  const parsed = networkDateInputSchema.safeParse(values)
  let report = null
  let invalid = values.requested !== undefined && !parsed.success
  if (parsed.success) {
    const { data, error } = await db.rpc('network_date_preview', {
      p_organization_id: context.active.id,
      ...networkDateRpcInput(parsed.data),
    })
    if (error?.code === 'MQ404') notFound()
    if (error?.code === 'MQ422') invalid = true
    else if (error) throw new Error('Network dates unavailable')
    else report = networkDateReportSchema.parse(data)
  }
  return (
    <div className="min-w-0 space-y-4 wrap-anywhere">
      <PageHeader
        pattern="replenishment"
        title={t('new')}
        description={`${saved.source_policy?.item_code} · ${saved.source_location_code} · ${saved.source_policy?.cutoff}`}
        help={
          <HelpDisclosure>
            <p>{t('method')}</p>
            <p>{t('noGuarantee')}</p>
          </HelpDisclosure>
        }
        back={
          <Link className="inline-block underline" href={`/replenishment/network/${draft.data}`}>
            {t('source')}
          </Link>
        }
      />
      <form
        action="/replenishment/network/dates/new"
        method="get"
        className="workspace-panel space-y-3"
        key={JSON.stringify(values)}
      >
        <input type="hidden" name="allocation" value={draft.data} />
        <label className="grid min-w-0 gap-1">
          {t('requested')}
          <input
            type="date"
            name="requested"
            required
            min={saved.source_policy?.cutoff}
            max="2100-12-31"
            defaultValue={values.requested ?? saved.source_policy?.cutoff}
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
      {report && <NetworkDateReport report={report} locale={locale} />}
      {report &&
        parsed.success &&
        canSaveNetworkDates(report.status) &&
        isEditorRole(context.role) && (
          <NextIntlClientProvider messages={{ NetworkDates: messages.NetworkDates }}>
            <NetworkDateSaveForm
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
