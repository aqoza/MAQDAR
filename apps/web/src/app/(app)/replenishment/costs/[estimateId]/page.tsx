import { NextIntlClientProvider } from 'next-intl'
import { PurchaseProposalForm } from '@/components/purchase-review-forms'
import { isEditorRole } from '@/lib/auth/roles'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getLocale, getTranslations, getMessages } from 'next-intl/server'
import { z } from 'zod'
import { PurchaseCostReport } from '@/components/purchase-cost-report'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { purchaseCostReportSchema } from '@/lib/purchase-costs'

export default async function SavedPurchaseCost({
  params,
}: {
  params: Promise<{ estimateId: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { estimateId } = await params
  if (!z.uuid().safeParse(estimateId).success) notFound()
  const [db, t, locale, format, review, messages] = await Promise.all([
    createClient(),
    getTranslations('PurchaseCosts'),
    getLocale(),
    getFormatter(),
    getTranslations('PurchaseReview'),
    getMessages(),
  ])
  const { data, error } = await db
    .from('purchase_cost_estimates')
    .select('report,created_at,submitted_by')
    .eq('organization_id', context.active.id)
    .eq('id', estimateId)
    .maybeSingle()
  if (error) throw new Error('Purchase cost unavailable')
  if (!data) notFound()
  const report = purchaseCostReportSchema.parse(data.report)
  return (
    <div className="space-y-5">
      <h1 className="text-page-title">{t('saved')}</h1>
      <p>
        {t('savedBy', {
          actor: data.submitted_by === context.userId ? t('you') : data.submitted_by,
          time: format.dateTime(new Date(data.created_at), 'long'),
        })}
      </p>
      <p>{t('immutable')}</p>
      <Link
        className="block underline"
        href={`/replenishment/review?draft=${report.source.draft_id}`}
      >
        {review('draftHistory')}
      </Link>
      <PurchaseCostReport report={report} locale={locale} />
      {report.status === 'available' && isEditorRole(context.role) && (
        <NextIntlClientProvider messages={{ PurchaseReview: messages.PurchaseReview }}>
          <PurchaseProposalForm
            organizationId={context.active.id}
            estimateId={estimateId}
            requestId={crypto.randomUUID()}
          />
        </NextIntlClientProvider>
      )}
      <Link
        className="inline-block underline"
        href={`/replenishment/costs/new?delivery=${report.source.delivery_id}`}
      >
        {t('newFromSource')}
      </Link>
    </div>
  )
}
