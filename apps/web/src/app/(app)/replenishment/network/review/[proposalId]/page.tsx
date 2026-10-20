import { NetworkHandoffForm } from '@/components/network-handoff-form'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getFormatter, getLocale, getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { NetworkDecisionForm } from '@/components/network-review-forms'
import { NetworkFreightReport } from '@/components/network-freight-report'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { networkFreightReportSchema } from '@/lib/network-freight'
import { workbenchRowSchema, networkTimingBlocked } from '@/lib/network-review'

export default async function NetworkReviewDetail({
  params,
}: {
  params: Promise<{ proposalId: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { proposalId } = await params
  if (!z.guid().safeParse(proposalId).success) notFound()
  const [db, t, locale, format, messages] = await Promise.all([
    createClient(),
    getTranslations('NetworkReview'),
    getLocale(),
    getFormatter(),
    getMessages(),
  ])
  const [record, list] = await Promise.all([
    db
      .from('network_transfer_proposals')
      .select('*')
      .eq('organization_id', context.active.id)
      .eq('id', proposalId)
      .maybeSingle(),
    db
      .from('network_review_list')
      .select('*')
      .eq('organization_id', context.active.id)
      .eq('id', proposalId)
      .maybeSingle(),
  ])
  if (record.error || list.error) throw new Error('Network review unavailable')
  if (!record.data || !list.data) notFound()
  const proposal = record.data
  const row = workbenchRowSchema.parse(list.data)
  const source = await db
    .from('network_freight_estimates')
    .select('report,scenario_id')
    .eq('organization_id', context.active.id)
    .eq('id', proposal.estimate_id)
    .single()
  if (source.error) throw new Error('Network evidence unavailable')
  const report = networkFreightReportSchema.parse(source.data.report)
  let freightMatches = false
  if (proposal.status === 'pending') {
    const current = await db.rpc('network_freight_preview', {
      p_organization_id: context.active.id,
      p_scenario_id: source.data.scenario_id,
      p_terms_confirmed: true,
    })
    if (current.error?.code === 'MQ404') notFound()
    if (current.error) throw new Error('Current freight evidence unavailable')
    const parsed = networkFreightReportSchema.parse(current.data)
    freightMatches = parsed.status === 'available' && parsed.fingerprint === report.fingerprint
  }
  const th = await getTranslations('NetworkHandoffs')
  const handoff = await db
    .from('network_transfer_handoffs')
    .select('id')
    .eq('organization_id', context.active.id)
    .eq('proposal_id', proposalId)
    .maybeSingle()
  if (handoff.error) throw new Error('Network handoff unavailable')
  const editor = ['owner', 'admin', 'planner'].includes(context.role ?? '')
  const actor = (id: string | null) =>
    id === context.userId ? t('you') : t('member', { id: id ?? '—' })
  const withdrawal = proposal.submitted_by === context.userId
  const reviewer = ['owner', 'admin', 'approver'].includes(context.role ?? '')
  return (
    <div className="min-w-0 space-y-4 wrap-anywhere">
      <PageHeader
        pattern="replenishment"
        back={
          <Link href="/replenishment/network/review" className="underline">
            {t('back')}
          </Link>
        }
        title={t('detailTitle', { item: row.item_code })}
        help={
          <HelpDisclosure>
            <p>{t('description')}</p>
          </HelpDisclosure>
        }
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
          href={`/replenishment/network/review?allocation=${proposal.allocation_id}`}
        >
          {t('allocationHistory')}
        </Link>
        <Link className="underline" href={`/replenishment/network/freight/${proposal.estimate_id}`}>
          {t('estimate')}
        </Link>
        <Link className="underline" href={`/replenishment/network/${proposal.allocation_id}`}>
          {t('sourceAllocation')}
        </Link>
      </div>
      {handoff.data ? (
        <Link
          href={`/replenishment/network/handoffs/${handoff.data.id}`}
          className="inline-block underline"
        >
          {th('open')}
        </Link>
      ) : row.selected && editor ? (
        <NextIntlClientProvider messages={{ NetworkHandoffs: messages.NetworkHandoffs }}>
          <NetworkHandoffForm organizationId={context.active.id} proposalId={proposal.id} />
        </NextIntlClientProvider>
      ) : null}
      <NetworkFreightReport report={report} locale={locale} />
      {proposal.status === 'pending' && (
        <>
          <p role="status">{t(freightMatches ? 'freightCurrent' : 'freightChanged')}</p>
          {networkTimingBlocked(report) && <p role="alert">{t('timingRequired')}</p>}
          {(withdrawal || reviewer) && (
            <NextIntlClientProvider messages={{ NetworkReview: messages.NetworkReview }}>
              <NetworkDecisionForm
                organizationId={context.active.id}
                proposalId={proposal.id}
                requestId={crypto.randomUUID()}
                withdrawal={withdrawal}
                approveBlocked={!freightMatches || networkTimingBlocked(report)}
              />
            </NextIntlClientProvider>
          )}
        </>
      )}
    </div>
  )
}
