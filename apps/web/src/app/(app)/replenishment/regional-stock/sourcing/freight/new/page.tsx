import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { RegionalFreightReport } from '@/components/regional-freight-report'
import { RegionalFreightSaveForm } from '@/components/regional-freight-save-form'
import { isEditorRole } from '@/lib/auth/roles'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { regionalDateReportSchema } from '@/lib/regional-dates'
import {
  regionalFreightParams,
  regionalFreightInputSchema,
  regionalFreightReportSchema,
  regionalFreightRpcInput,
  canSaveRegionalFreight,
} from '@/lib/regional-freight'
import type { RawSearchParams } from '@/lib/master-data/list-params'

export default async function NewRegionalFreight({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  if (!isEditorRole(context.role)) notFound()
  const [db, t, locale, messages, raw] = await Promise.all([
    createClient(),
    getTranslations('RegionalFreight'),
    getLocale(),
    getMessages(),
    searchParams,
  ])
  const values = regionalFreightParams(raw)
  const draft = z.guid().safeParse(values.scenario)
  if (!draft.success) notFound()
  const source = await db
    .from('regional_date_scenarios')
    .select('report')
    .eq('organization_id', context.active.id)
    .eq('id', draft.data)
    .maybeSingle()
  if (source.error) throw new Error('Transfer date scenario unavailable')
  if (!source.data) notFound()
  const saved = regionalDateReportSchema.parse(source.data.report)
  const parsed = regionalFreightInputSchema.safeParse(values)
  let report = null
  let invalid = !parsed.success
  if (parsed.success) {
    const { data, error } = await db.rpc('regional_freight_preview', {
      p_organization_id: context.active.id,
      ...regionalFreightRpcInput(parsed.data),
    })
    if (error?.code === 'MQ404') notFound()
    if (error?.code === 'MQ422') invalid = true
    else if (error) throw new Error('Freight preview unavailable')
    else report = regionalFreightReportSchema.parse(data)
  }
  return (
    <div className="min-w-0 space-y-4 wrap-anywhere">
      <PageHeader
        pattern="replenishment"
        title={t('new')}
        description={`${saved.source.destination.policy.item_code} · ${saved.source.destination.policy.location_code}`}
        help={
          <HelpDisclosure>
            <p>{t('method')}</p>
            <p>{t('noGuarantee')}</p>
          </HelpDisclosure>
        }
        back={
          <Link
            className="inline-block underline"
            href={`/replenishment/regional-stock/sourcing/dates/${draft.data}`}
          >
            {t('source')}
          </Link>
        }
      />
      <form
        action="/replenishment/regional-stock/sourcing/freight/new"
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
      {report && <RegionalFreightReport report={report} locale={locale} />}
      {report &&
        parsed.success &&
        canSaveRegionalFreight(report.status) &&
        isEditorRole(context.role) && (
          <NextIntlClientProvider messages={{ RegionalFreight: messages.RegionalFreight }}>
            <RegionalFreightSaveForm
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
