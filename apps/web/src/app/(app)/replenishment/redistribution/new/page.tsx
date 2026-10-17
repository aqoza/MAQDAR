import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { RedistributionSourcePicker } from '@/components/redistribution-source-picker'
import { RedistributionReport } from '@/components/redistribution-report'
import { RedistributionSaveForm } from '@/components/redistribution-save-form'
import { isEditorRole } from '@/lib/auth/roles'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { replenishmentReportSchema } from '@/lib/replenishment'
import {
  redistributionParams,
  redistributionInputSchema,
  redistributionReportSchema,
  redistributionRpcInput,
  redistributionListParams,
} from '@/lib/redistribution'
import { lastPage, type RawSearchParams } from '@/lib/master-data/list-params'
import { formatScore } from '@/lib/forecast-quality'

export default async function NewRedistribution({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const [db, t, locale, messages, raw] = await Promise.all([
    createClient(),
    getTranslations('Redistribution'),
    getLocale(),
    getMessages(),
    searchParams,
  ])
  const values = redistributionParams(raw)
  if (!z.uuid().safeParse(values.draft).success) notFound()
  const draftId = values.draft!
  const organizationId = context.active.id
  const draft = await db
    .from('replenishment_drafts')
    .select('report,policy_id,location_id')
    .eq('organization_id', organizationId)
    .eq('id', draftId)
    .maybeSingle()
  if (draft.error) throw new Error('Destination draft unavailable')
  if (!draft.data) notFound()
  const destination = replenishmentReportSchema.parse(draft.data.report)
  const item = await db
    .from('inventory_policies')
    .select('item_id')
    .eq('organization_id', organizationId)
    .eq('id', draft.data.policy_id)
    .maybeSingle()
  if (item.error) throw new Error('Destination policy unavailable')
  if (!item.data) notFound()
  const header = (
    <PageHeader
      title={t('new')}
      description={`${destination.policy.item_code} · ${destination.policy.location_code} · ${destination.policy.cutoff}`}
      help={
        <HelpDisclosure>
          <p>{t('asOf')}</p>
          <p>{t('noReservation')}</p>
        </HelpDisclosure>
      }
    />
  )
  const back = (
    <Link className="inline-block underline" href={`/replenishment/${draftId}`}>
      {t('openDestination')}
    </Link>
  )
  if (destination.status !== 'available' || !destination.policy.unit)
    return (
      <div className="min-w-0 space-y-4 wrap-anywhere">
        {back}
        {header}
        <p role="alert">{t('statuses.destination_unavailable')}</p>
      </div>
    )
  if (!values.policy)
    return (
      <div className="min-w-0 space-y-4 wrap-anywhere">
        {back}
        {header}
        <RedistributionSourcePicker
          organizationId={organizationId}
          draftId={draftId}
          locationId={draft.data.location_id}
          itemId={item.data.item_id}
          cutoff={destination.policy.cutoff}
          unit={destination.policy.unit}
          locale={locale}
          raw={raw}
        />
      </div>
    )
  if (!z.uuid().safeParse(values.policy).success) notFound()
  const policy = await db
    .from('policy_workbench')
    .select('id,location_id,location_code,calculated_maximum,unit,to_date')
    .eq('organization_id', organizationId)
    .eq('id', values.policy)
    .maybeSingle()
  if (policy.error) throw new Error('Source policy unavailable')
  if (!policy.data) notFound()
  const revisionsPage = redistributionListParams({ page: raw.revisionsPage }).page
  const revisions = await db
    .from('policy_override_history')
    .select('id,revision,order_up_to', { count: 'exact' })
    .eq('organization_id', organizationId)
    .eq('policy_id', values.policy)
    .eq('status', 'approved')
    .order('revision', { ascending: false })
    .range((revisionsPage - 1) * 25, revisionsPage * 25 - 1)
  const revisionPages = lastPage(revisions.count ?? 0, 25)
  const revisionHref = (page: number) => {
    const query = new URLSearchParams(
      Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined),
    )
    query.set('revisionsPage', String(page))
    return `/replenishment/redistribution/new?${query}`
  }
  if (revisions.error?.code === 'PGRST103' || revisionsPage > revisionPages)
    redirect(revisionHref(revisionPages))
  if (revisions.error) throw new Error('Source revisions unavailable')
  let options = revisions.data ?? []
  if (
    z.uuid().safeParse(values.maximum).success &&
    !options.some((option) => option.id === values.maximum)
  ) {
    const selected = await db
      .from('policy_override_history')
      .select('id,revision,order_up_to')
      .eq('organization_id', organizationId)
      .eq('policy_id', values.policy)
      .eq('status', 'approved')
      .eq('id', values.maximum!)
      .maybeSingle()
    if (selected.error) throw new Error('Source revision unavailable')
    if (selected.data) options = [selected.data, ...options]
  }
  const lane = await db
    .from('network_links')
    .select('lead_time_days_p50,lead_time_days_p90,is_active')
    .eq('organization_id', organizationId)
    .eq('from_location_id', policy.data.location_id!)
    .eq('to_location_id', draft.data.location_id)
    .maybeSingle()
  if (lane.error) throw new Error('Lane unavailable')
  const parsed = redistributionInputSchema.safeParse(values)
  let report = null
  if (parsed.success) {
    const result = await db.rpc('redistribution_preview', {
      p_organization_id: organizationId,
      ...redistributionRpcInput(parsed.data),
    })
    if (result.error?.code === 'MQ404') notFound()
    if (result.error) throw new Error('Redistribution preview unavailable')
    report = redistributionReportSchema.parse(result.data)
  }
  return (
    <div className="min-w-0 space-y-4 wrap-anywhere">
      {back}
      {header}
      <div className="workspace-panel flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-section-title">
            {policy.data.location_code} → {destination.policy.location_code}
          </h2>
          {lane.data && (
            <p>
              {t('leadTimes', {
                p50: lane.data.lead_time_days_p50,
                p90: lane.data.lead_time_days_p90,
              })}{' '}
              · {t(lane.data.is_active ? 'activeLane' : 'inactiveLane')}
            </p>
          )}
          <p className="text-sm text-muted-foreground">{t('timingNotAssessed')}</p>
        </div>
        <Link className="underline" href={`/replenishment/redistribution/new?draft=${draftId}`}>
          {t('changeSource')}
        </Link>
      </div>
      <form
        method="get"
        action="/replenishment/redistribution/new"
        className="workspace-panel space-y-4"
        key={JSON.stringify(values)}
      >
        <input type="hidden" name="draft" value={draftId} />
        <input type="hidden" name="policy" value={values.policy} />
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid min-w-0 gap-1">
            {t('maximumSelection')}
            <select
              name="maximum"
              required
              defaultValue={values.maximum ?? ''}
              className="w-full min-w-0 rounded-md border bg-background p-2"
            >
              <option value="" disabled>
                {t('chooseMaximum')}
              </option>
              <option value="calculated">
                {t('calculated')} · {formatScore(policy.data.calculated_maximum, locale)}{' '}
                {policy.data.unit ?? '—'}
              </option>
              {options.map((option) => (
                <option key={option.id} value={option.id!}>
                  {t('approved', { revision: option.revision ?? 0 })} ·{' '}
                  {formatScore(option.order_up_to, locale)} {policy.data!.unit ?? '—'}
                </option>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 gap-1">
            {t('backorders')}
            <input
              name="backorders"
              required
              inputMode="decimal"
              maxLength={19}
              defaultValue={values.backorders ?? ''}
              className="w-full min-w-0 rounded-md border bg-background p-2"
              aria-describedby="backorders-help"
            />
          </label>
        </div>
        <p id="backorders-help" className="text-sm text-muted-foreground">
          {t('backordersHelp')}
        </p>
        {revisionPages > 1 && (
          <nav aria-label={t('revisionPages')} className="flex flex-wrap gap-4">
            {revisionsPage > 1 && (
              <Link className="underline" href={revisionHref(revisionsPage - 1)}>
                {t('previous')}
              </Link>
            )}
            <span>{t('page', { page: revisionsPage, pages: revisionPages })}</span>
            {revisionsPage < revisionPages && (
              <Link className="underline" href={revisionHref(revisionsPage + 1)}>
                {t('olderRevisions')}
              </Link>
            )}
          </nav>
        )}
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            name="commitments"
            value="true"
            defaultChecked={values.commitments === 'true'}
            className="mt-1"
          />
          {t('commitmentsConfirmation', { date: destination.policy.cutoff })}
        </label>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            name="lane"
            value="true"
            defaultChecked={values.lane === 'true'}
            className="mt-1"
          />
          {t('laneConfirmation', { date: destination.policy.cutoff })}
        </label>
        <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
          {t('preview')}
        </button>
      </form>
      {!parsed.success && values.backorders !== undefined && <p role="alert">{t('invalid')}</p>}
      {report && <RedistributionReport report={report} locale={locale} />}
      {report?.status === 'available' && parsed.success && isEditorRole(context.role) && (
        <NextIntlClientProvider messages={{ Redistribution: messages.Redistribution }}>
          <RedistributionSaveForm
            key={report.fingerprint}
            organizationId={organizationId}
            input={{
              ...parsed.data,
              commitments: 'true',
              lane: 'true',
              fingerprint: report.fingerprint,
              request_id: crypto.randomUUID(),
            }}
          />
        </NextIntlClientProvider>
      )}
    </div>
  )
}
