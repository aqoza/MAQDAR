import Link from 'next/link'
import { PurchaseHandoffForm } from '@/components/purchase-handoff-form'
import { isEditorRole } from '@/lib/auth/roles'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getFormatter, getLocale, getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PurchaseDecisionForm } from '@/components/purchase-review-forms'
import { PurchaseCostReport } from '@/components/purchase-cost-report'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { purchaseCostReportSchema } from '@/lib/purchase-costs'
import { workbenchRowSchema } from '@/lib/purchase-review'

export default async function PurchaseReviewDetail({
  params,
}: {
  params: Promise<{ proposalId: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { proposalId } = await params
  if (!z.uuid().safeParse(proposalId).success) notFound()
  const [db, t, locale, format, messages] = await Promise.all([
    createClient(),
    getTranslations('PurchaseReview'),
    getLocale(),
    getFormatter(),
    getMessages(),
  ])
  const [record, list] = await Promise.all([
    db
      .from('purchase_proposals')
      .select('*')
      .eq('organization_id', context.active.id)
      .eq('id', proposalId)
      .maybeSingle(),
    db
      .from('purchase_review_list')
      .select('*')
      .eq('organization_id', context.active.id)
      .eq('id', proposalId)
      .maybeSingle(),
  ])
  if (record.error || list.error) throw new Error('Purchase review unavailable')
  if (!record.data || !list.data) notFound()
  const ht = await getTranslations('PurchaseHandoffs')
  const handoff = await db
    .from('purchase_handoffs')
    .select('id')
    .eq('organization_id', context.active.id)
    .eq('proposal_id', proposalId)
    .maybeSingle()
  if (handoff.error) throw new Error('Handoff unavailable')
  const proposal = record.data
  const row = workbenchRowSchema.parse(list.data)
  const source = await db
    .from('purchase_cost_estimates')
    .select('report,delivery_id')
    .eq('organization_id', context.active.id)
    .eq('id', proposal.estimate_id)
    .single()
  if (source.error) throw new Error('Purchase evidence unavailable')
  const report = purchaseCostReportSchema.parse(source.data.report)
  let priceMatches = false
  if (proposal.status === 'pending') {
    const current = await db.rpc('purchase_cost_preview', {
      p_organization_id: context.active.id,
      p_delivery_id: source.data.delivery_id,
      p_price_confirmed: true,
    })
    if (current.error) throw new Error('Current price evidence unavailable')
    const parsed = purchaseCostReportSchema.parse(current.data)
    priceMatches = parsed.status === 'available' && parsed.fingerprint === report.fingerprint
  }
  const actor = (id: string | null) =>
    id === context.userId ? t('you') : t('member', { id: id ?? '—' })
  const withdrawal = proposal.submitted_by === context.userId
  const reviewer = ['owner', 'admin', 'approver'].includes(context.role ?? '')
  return (
    <div className="space-y-5">
      <Link href="/replenishment/review" className="underline">
        {t('back')}
      </Link>
      <h1 className="text-page-title">{t('detailTitle', { item: row.item_code })}</h1>
      <p>{t('description')}</p>
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
        <Link className="underline" href={`/replenishment/review?draft=${proposal.draft_id}`}>
          {t('draftHistory')}
        </Link>
        <Link className="underline" href={`/replenishment/costs/${proposal.estimate_id}`}>
          {t('estimate')}
        </Link>
        <Link className="underline" href={`/replenishment/${proposal.draft_id}`}>
          {t('sourceDraft')}
        </Link>
      </div>
      <PurchaseCostReport report={report} locale={locale} />
      {handoff.data ? (
        <Link
          className="inline-block underline"
          href={`/replenishment/handoffs/${handoff.data.id}`}
        >
          {ht('open')}
        </Link>
      ) : row.selected && isEditorRole(context.role) ? (
        <NextIntlClientProvider messages={{ PurchaseHandoffs: messages.PurchaseHandoffs }}>
          <PurchaseHandoffForm organizationId={context.active.id} proposalId={proposal.id} />
        </NextIntlClientProvider>
      ) : null}
      {proposal.status === 'pending' && (
        <>
          <p role="status">{t(priceMatches ? 'priceCurrent' : 'priceChanged')}</p>
          {report.source.policy_recalculation_required !== false && (
            <p role="alert">{t('policyRequired')}</p>
          )}
          {(withdrawal || reviewer) && (
            <NextIntlClientProvider messages={{ PurchaseReview: messages.PurchaseReview }}>
              <PurchaseDecisionForm
                organizationId={context.active.id}
                proposalId={proposal.id}
                requestId={crypto.randomUUID()}
                withdrawal={withdrawal}
                approveBlocked={
                  !priceMatches || report.source.policy_recalculation_required !== false
                }
              />
            </NextIntlClientProvider>
          )}
        </>
      )}
    </div>
  )
}
