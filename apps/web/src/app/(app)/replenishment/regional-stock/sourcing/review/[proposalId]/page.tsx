import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getFormatter, getLocale, getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { RegionalDecisionForm } from '@/components/regional-review-forms'
import { RegionalFreightReport } from '@/components/regional-freight-report'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { regionalFreightReportSchema } from '@/lib/regional-freight'
import { workbenchRowSchema, regionalTimingBlocked } from '@/lib/regional-review'

export default async function RegionalReviewDetail({
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
    getTranslations('RegionalReview'),
    getLocale(),
    getFormatter(),
    getMessages(),
  ])
  const [record, list] = await Promise.all([
    db
      .from('regional_transfer_proposals')
      .select('*')
      .eq('organization_id', context.active.id)
      .eq('id', proposalId)
      .maybeSingle(),
    db
      .from('regional_review_list')
      .select('*')
      .eq('organization_id', context.active.id)
      .eq('id', proposalId)
      .maybeSingle(),
  ])
  if (record.error || list.error) throw new Error('Regional review unavailable')
  if (!record.data || !list.data) notFound()
  const proposal = record.data
  const row = workbenchRowSchema.parse(list.data)
  const source = await db
    .from('regional_freight_estimates')
    .select('report,scenario_id')
    .eq('organization_id', context.active.id)
    .eq('id', proposal.estimate_id)
    .single()
  if (source.error) throw new Error('Regional evidence unavailable')
  const report = regionalFreightReportSchema.parse(source.data.report)
  let freightMatches = false
  if (proposal.status === 'pending') {
    const current = await db.rpc('regional_freight_preview', {
      p_organization_id: context.active.id,
      p_scenario_id: source.data.scenario_id,
      p_terms_confirmed: true,
    })
    if (current.error && current.error.code !== 'MQ404')
      throw new Error('Current freight evidence unavailable')
    if (!current.error) {
      const parsed = regionalFreightReportSchema.parse(current.data)
      freightMatches = parsed.status === 'available' && parsed.fingerprint === report.fingerprint
    }
  }
  const isolate = (value: string) => `\u2068${value}\u2069`
  const actor = (id: string | null) =>
    id === context.userId ? t('you') : t('member', { id: isolate(id ?? '—') })
  const withdrawal = proposal.submitted_by === context.userId
  const reviewer = ['owner', 'admin', 'approver'].includes(context.role ?? '')
  return (
    <div className="min-w-0 space-y-4 wrap-anywhere">
      <PageHeader
        pattern="replenishment"
        back={
          <Link href="/replenishment/regional-stock/sourcing/review" className="underline">
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
          actor: isolate(actor(proposal.submitted_by)),
          time: isolate(format.dateTime(new Date(proposal.created_at), 'long')),
        })}
      </p>
      <p className="whitespace-pre-wrap break-words">
        {t('reason')}: {proposal.reason}
      </p>
      {proposal.decided_at && (
        <>
          <p>
            {t('decided', {
              actor: isolate(actor(proposal.decided_by)),
              time: isolate(format.dateTime(new Date(proposal.decided_at), 'long')),
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
          href={`/replenishment/regional-stock/sourcing/review?sourcing=${proposal.sourcing_id}`}
        >
          {t('sourcingHistory')}
        </Link>
        <Link
          className="underline"
          href={`/replenishment/regional-stock/sourcing/freight/${proposal.estimate_id}`}
        >
          {t('estimate')}
        </Link>
        <Link
          className="underline"
          href={`/replenishment/regional-stock/sourcing/${proposal.sourcing_id}`}
        >
          {t('sourceSourcing')}
        </Link>
      </div>
      {proposal.status === 'pending' && (
        <>
          <p role="status">{t(freightMatches ? 'freightCurrent' : 'freightChanged')}</p>
          {regionalTimingBlocked(report) && <p role="alert">{t('timingRequired')}</p>}
          {(withdrawal || reviewer) && (
            <NextIntlClientProvider messages={{ RegionalReview: messages.RegionalReview }}>
              <RegionalDecisionForm
                organizationId={context.active.id}
                proposalId={proposal.id}
                requestId={crypto.randomUUID()}
                withdrawal={withdrawal}
                approveBlocked={!freightMatches || regionalTimingBlocked(report)}
              />
            </NextIntlClientProvider>
          )}
        </>
      )}
      <RegionalFreightReport report={report} locale={locale} />
    </div>
  )
}
