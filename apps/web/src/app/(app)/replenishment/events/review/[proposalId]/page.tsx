import { EventPurchaseHandoffForm } from '@/components/event-purchase-handoff-form'
import { PageHeader } from '@/components/page-header'
import { EventPurchaseReviewHelp } from '@/components/event-purchase-review-help'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getFormatter, getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { EventPurchaseDecisionForm } from '@/components/event-purchase-review-forms'
import { EventCostReport } from '@/components/event-cost-report'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import {
  workbenchRowSchema,
  eventApprovalTimingClear,
  eventReviewCostSchema,
} from '@/lib/event-purchase-review'

export default async function EventPurchaseReviewDetail({
  params,
}: {
  params: Promise<{ proposalId: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { proposalId } = await params
  if (!z.guid().safeParse(proposalId).success) notFound()
  const [db, t, format, messages] = await Promise.all([
    createClient(),
    getTranslations('EventPurchaseReview'),
    getFormatter(),
    getMessages(),
  ])
  const [record, list] = await Promise.all([
    db
      .from('event_purchase_proposals')
      .select('*')
      .eq('organization_id', context.active.id)
      .eq('id', proposalId)
      .maybeSingle(),
    db
      .from('event_purchase_review_list')
      .select('*')
      .eq('organization_id', context.active.id)
      .eq('id', proposalId)
      .maybeSingle(),
  ])
  if (record.error || list.error) throw new Error('Purchase review unavailable')
  if (!record.data || !list.data) notFound()
  const proposal = record.data
  const row = workbenchRowSchema.parse(list.data)
  const source = await db
    .from('event_purchase_cost_estimates')
    .select('report,delivery_id')
    .eq('organization_id', context.active.id)
    .eq('id', proposal.estimate_id)
    .single()
  if (source.error) throw new Error('Purchase evidence unavailable')
  const report = eventReviewCostSchema.parse(source.data.report)
  let priceMatches = false
  if (proposal.status === 'pending') {
    const current = await db.rpc('event_purchase_cost_preview', {
      p_organization_id: context.active.id,
      p_delivery_id: source.data.delivery_id,
      p_price_confirmed: true,
    })
    if (current.error) throw new Error('Current price evidence unavailable')
    const parsed = z.object({ status: z.string(), fingerprint: z.string() }).parse(current.data)
    priceMatches = parsed.status === 'available' && parsed.fingerprint === report.fingerprint
  }
  const handoff = await db
    .from('event_purchase_handoffs')
    .select('id')
    .eq('organization_id', context.active.id)
    .eq('proposal_id', proposal.id)
    .maybeSingle()
  if (handoff.error) throw new Error('Event handoff unavailable')
  const handoffText = await getTranslations('EventPurchaseHandoffs')
  const editor = ['owner', 'admin', 'planner'].includes(context.role ?? '')
  const actor = (id: string | null) =>
    id === context.userId ? t('you') : t('member', { id: id ?? '—' })
  const withdrawal = proposal.submitted_by === context.userId
  const reviewer = ['owner', 'admin', 'approver'].includes(context.role ?? '')
  return (
    <div className="space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('detailTitle', { item: row.item_code })}
        description={<span className="break-words">{row.event_name}</span>}
        actions={
          <Link href="/replenishment/events/review" className="underline">
            {t('back')}
          </Link>
        }
        help={<EventPurchaseReviewHelp />}
      />
      <h2 className="text-section-title">
        {t('revision', { revision: proposal.revision })} · {t(`statuses.${row.status}`)}
      </h2>
      {row.selected && <p role="status">{t('selected')}</p>}
      {row.status === 'approved' && !row.selected && <p>{t('historicalApproval')}</p>}
      <p>
        {t('submitted', {
          actor: actor(proposal.submitted_by),
          time: format.dateTime(new Date(proposal.created_at), 'long'),
        })}
      </p>
      <p className="whitespace-pre-wrap break-words">
        {t('reason')}: {proposal.reason}
      </p>
      {proposal.decided_at && (
        <>
          <p>
            {t('decided', {
              actor: actor(proposal.decided_by),
              time: format.dateTime(new Date(proposal.decided_at), 'long'),
            })}
          </p>
          <p className="whitespace-pre-wrap break-words">
            {t('decisionReason')}: {proposal.decision_reason}
          </p>
        </>
      )}
      <div className="flex flex-wrap gap-4">
        <Link
          className="underline"
          href={`/replenishment/events/review?draft=${proposal.draft_id}`}
        >
          {t('draftHistory')}
        </Link>
        <Link className="underline" href={`/replenishment/events/costs/${proposal.estimate_id}`}>
          {t('estimate')}
        </Link>
        <Link className="underline" href={`/replenishment/events/${proposal.draft_id}`}>
          {t('sourceDraft')}
        </Link>
      </div>
      {handoff.data ? (
        <Link className="underline" href={`/replenishment/events/handoffs/${handoff.data.id}`}>
          {handoffText('open')}
        </Link>
      ) : row.selected && editor ? (
        <NextIntlClientProvider
          messages={{ EventPurchaseHandoffs: messages.EventPurchaseHandoffs }}
        >
          <EventPurchaseHandoffForm organizationId={context.active.id} proposalId={proposal.id} />
        </NextIntlClientProvider>
      ) : null}
      <EventCostReport report={report} />
      {proposal.status === 'pending' && (
        <>
          <p role="status">{t(priceMatches ? 'priceCurrent' : 'priceChanged')}</p>
          {report.source.policy_recalculation_required !== false && (
            <p role="alert">{t('policyRequired')}</p>
          )}
          {!Array.isArray(report.source.event_before_receipt) ||
          report.source.event_before_receipt.length > 0 ? (
            <p role="alert">{t('timingRequired')}</p>
          ) : null}
          {(withdrawal || reviewer) && (
            <NextIntlClientProvider
              messages={{ EventPurchaseReview: messages.EventPurchaseReview }}
            >
              <EventPurchaseDecisionForm
                organizationId={context.active.id}
                proposalId={proposal.id}
                requestId={crypto.randomUUID()}
                withdrawal={withdrawal}
                approveBlocked={!priceMatches || !eventApprovalTimingClear(report.source)}
              />
            </NextIntlClientProvider>
          )}
        </>
      )}
    </div>
  )
}
