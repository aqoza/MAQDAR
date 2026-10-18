import Link from 'next/link'
import { HandoffAcknowledgements } from '@/components/handoff-acknowledgements'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { EventPurchaseHandoffsHelp } from '@/components/event-purchase-handoffs-help'
import { EventCostReport } from '@/components/event-cost-report'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { handoffPayloadSchema } from '@/lib/event-purchase-handoffs'

export default async function EventHandoffDetail({
  params,
  searchParams,
}: {
  params: Promise<{ handoffId: string }>
  searchParams: Promise<{ ack_page?: string | string[] }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { handoffId } = await params
  if (!z.guid().safeParse(handoffId).success) notFound()
  const [db, t, format] = await Promise.all([
    createClient(),
    getTranslations('EventPurchaseHandoffs'),
    getFormatter(),
  ])
  const [record, current] = await Promise.all([
    db
      .from('event_purchase_handoffs')
      .select('payload')
      .eq('organization_id', context.active.id)
      .eq('id', handoffId)
      .maybeSingle(),
    db
      .from('event_purchase_handoff_list')
      .select('selected')
      .eq('organization_id', context.active.id)
      .eq('id', handoffId)
      .maybeSingle(),
  ])
  if (record.error || current.error) throw new Error('Event handoff unavailable')
  if (!record.data || !current.data) notFound()
  const payload = handoffPayloadSchema.parse(record.data.payload)
  const event = payload.estimate.source.source.draft.scenario.event
  const price = await db.rpc('event_purchase_cost_preview', {
    p_organization_id: context.active.id,
    p_delivery_id: payload.evidence.delivery_id,
    p_price_confirmed: true,
  })
  // Current context never rewrites or hides an authorized historical download.
  const parsed = price.error
    ? null
    : z.object({ status: z.string(), fingerprint: z.string() }).safeParse(price.data)
  const priceState = !parsed?.success
    ? 'priceUnknown'
    : parsed.data.status === 'available' && parsed.data.fingerprint === payload.estimate.fingerprint
      ? 'priceCurrent'
      : 'priceChanged'
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('detailTitle', { item: event.source.item_code })}
        description={<span className="break-words">{event.input.name}</span>}
        actions={
          <Link className="underline" href="/replenishment/events/handoffs">
            {t('back')}
          </Link>
        }
        help={<EventPurchaseHandoffsHelp />}
      />
      <p>{t('savedAt', { time: format.dateTime(new Date(payload.created_at), 'long') })}</p>
      <p className="break-all">{t('identity', { id: payload.handoff_id })}</p>
      <section className="space-y-2 workspace-panel" aria-label={t('currentContext')}>
        <h2 className="text-section-title">{t('currentContext')}</h2>
        <p role="status">{t(current.data.selected ? 'current' : 'historical')}</p>
        <p>{t(priceState)}</p>
      </section>
      <div className="flex flex-wrap gap-4">
        <a download href={`/api/event-purchase-handoffs/${handoffId}/json`} className="underline">
          {t('json')}
        </a>
        <a download href={`/api/event-purchase-handoffs/${handoffId}/csv`} className="underline">
          {t('csv')}
        </a>
        <Link href={`/replenishment/events/review/${payload.proposal.id}`} className="underline">
          {t('proposal')}
        </Link>
        <Link
          href={`/replenishment/events/costs/${payload.proposal.estimate_id}`}
          className="underline"
        >
          {t('estimate')}
        </Link>
      </div>
      <p>{t('selectionHelp')}</p>
      <HandoffAcknowledgements
        organizationId={context.active.id}
        recordId={handoffId}
        kind="event"

        pageValue={(await searchParams).ack_page}
      />
      <EventCostReport report={payload.estimate} />
    </div>
  )
}
