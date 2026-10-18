import { HandoffAcknowledgements } from '@/components/handoff-acknowledgements'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { HelpDisclosure } from '@/components/help-disclosure'
import { TransferFreightReport } from '@/components/transfer-freight-report'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { handoffPayloadSchema } from '@/lib/transfer-handoffs'
import { transferFreightReportSchema } from '@/lib/transfer-freight'

export default async function TransferHandoffDetail({
  params,
  searchParams,
}: {
  searchParams: Promise<{ ack_page?: string | string[] }>
  params: Promise<{ handoffId: string }>
}) {
  const { ack_page } = await searchParams
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { handoffId } = await params
  if (!z.guid().safeParse(handoffId).success) notFound()
  const [db, t, locale, format] = await Promise.all([
    createClient(),
    getTranslations('TransferHandoffs'),
    getLocale(),
    getFormatter(),
  ])
  const [record, current] = await Promise.all([
    db
      .from('transfer_handoffs')
      .select('payload')
      .eq('organization_id', context.active.id)
      .eq('id', handoffId)
      .maybeSingle(),
    db
      .from('transfer_handoff_list')
      .select('selected')
      .eq('organization_id', context.active.id)
      .eq('id', handoffId)
      .maybeSingle(),
  ])
  if (record.error || current.error) throw new Error('Transfer handoff unavailable')
  if (!record.data || !current.data) notFound()
  const payload = handoffPayloadSchema.parse(record.data.payload)
  const freight = await db.rpc('transfer_freight_preview', {
    p_organization_id: context.active.id,
    p_scenario_id: payload.estimate.scenario_id,
    p_terms_confirmed: true,
  })
  // A failed live check must not hide immutable files or imply an evidence match.
  const parsed = freight.error ? null : transferFreightReportSchema.safeParse(freight.data)
  const freightState = !parsed?.success
    ? 'freightUnknown'
    : parsed.data.status === 'available' && parsed.data.fingerprint === payload.estimate.fingerprint
      ? 'freightCurrent'
      : 'freightChanged'
  return (
    <div className="min-w-0 space-y-4 wrap-anywhere">
      <Link className="underline" href="/replenishment/redistribution/handoffs">
        {t('back')}
      </Link>
      <h1 className="text-page-title">
        {t('detailTitle', { item: payload.estimate.source.source.destination.policy.item_code })}
      </h1>
      <HelpDisclosure>
        <p>{t('description')}</p>
        <p>{t('csvNote')}</p>
        <p>{t('immutableNote')}</p>
      </HelpDisclosure>
      <p>{t('savedAt', { time: format.dateTime(new Date(payload.created_at), 'long') })}</p>
      <p className="break-all">{t('identity', { id: payload.handoff_id })}</p>
      <div className="flex flex-wrap gap-4">
        <a download href={`/api/transfer-handoffs/${handoffId}/json`} className="underline">
          {t('json')}
        </a>
        <a download href={`/api/transfer-handoffs/${handoffId}/csv`} className="underline">
          {t('csv')}
        </a>
        <Link
          href={`/replenishment/redistribution/review/${payload.proposal.id}`}
          className="underline"
        >
          {t('proposal')}
        </Link>
        <Link
          href={`/replenishment/redistribution/freight/${payload.proposal.estimate_id}`}
          className="underline"
        >
          {t('estimate')}
        </Link>
      </div>
      <div className="grid min-w-0 gap-3 lg:grid-cols-2">
        <section className="min-w-0 space-y-2 workspace-panel" aria-label={t('currentContext')}>
          <h2 className="text-section-title">{t('currentContext')}</h2>
          <p role="status">{t(current.data.selected ? 'current' : 'historical')}</p>
          <p>{t(freightState)}</p>
        </section>
        <section className="min-w-0 space-y-2 workspace-panel" aria-label={t('approval')}>
          <h2 className="text-section-title">{t('approval')}</h2>
          <p>
            {t('approvedAt', {
              time: format.dateTime(new Date(payload.proposal.approved_at), 'long'),
            })}
          </p>
          <p className="whitespace-pre-wrap">
            {t('approvalReason')}: {payload.proposal.approval_reason}
          </p>
        </section>
      </div>
      <TransferFreightReport report={payload.estimate} locale={locale} />
      <HandoffAcknowledgements
        organizationId={context.active.id}
        recordId={handoffId}
        kind="transfer"
        pageValue={ack_page}
      />
    </div>
  )
}
