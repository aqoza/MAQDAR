import { NextIntlClientProvider } from 'next-intl'
import { EventPurchaseProposalForm } from '@/components/event-purchase-review-forms'
import { isEditorRole } from '@/lib/auth/roles'
import { isZeroQuantity } from '@/lib/event-deliveries'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getTranslations, getMessages } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { EventCostReport } from '@/components/event-cost-report'
import { eventCostReportSchema } from '@/lib/event-costs'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'

export default async function EventCostDetail({
  params,
}: {
  params: Promise<{ estimateId: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { estimateId } = await params
  if (!z.guid().safeParse(estimateId).success) notFound()
  const [db, t, format, review, messages] = await Promise.all([
    createClient(),
    getTranslations('EventCosts'),
    getFormatter(),
    getTranslations('EventPurchaseReview'),
    getMessages(),
  ])
  const { data, error } = await db
    .from('event_purchase_cost_estimates')
    .select('created_at,report')
    .eq('organization_id', context.active.id)
    .eq('id', estimateId)
    .maybeSingle()
  if (error) throw new Error('Event cost comparison unavailable')
  if (!data) notFound()
  const report = eventCostReportSchema.parse(data.report)
  return (
    <div className="space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('saved')}
        description={
          <span className="break-words">
            {report.source.source.draft.scenario.event.input.name}
          </span>
        }
        actions={
          <Link
            className="underline"
            href={`/replenishment/events/costs?delivery=${report.input.delivery_id}`}
          >
            {t('history')}
          </Link>
        }
      />
      <p className="text-sm">
        <bdi>
          {report.source.source.draft.scenario.event.source.item_code} ·{' '}
          {report.source.source.draft.scenario.event.source.location_code} ·{' '}
          {report.source.source.draft.scenario.event.input.unit}
        </bdi>{' '}
        · {t('cutoff', { date: report.source.source.draft.scenario.event.source.cutoff })}
      </p>
      <Link
        className="underline"
        href={`/replenishment/events/review?draft=${report.source.source.input.draft_id}`}
      >
        {review('draftHistory')}
      </Link>
      <EventCostReport report={report} />
      {report.status === 'available' &&
        !isZeroQuantity(report.adjusted.quantity) &&
        isEditorRole(context.role) && (
          <NextIntlClientProvider messages={{ EventPurchaseReview: messages.EventPurchaseReview }}>
            <EventPurchaseProposalForm
              organizationId={context.active.id}
              estimateId={estimateId}
              requestId={crypto.randomUUID()}
            />
          </NextIntlClientProvider>
        )}
      <p className="text-xs text-muted-foreground">
        {t('savedAt', { time: format.dateTime(new Date(data.created_at), 'long') })}
      </p>
    </div>
  )
}
