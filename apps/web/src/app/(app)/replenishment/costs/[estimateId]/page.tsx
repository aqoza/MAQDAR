import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
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
  const [db, t, locale, format] = await Promise.all([
    createClient(),
    getTranslations('PurchaseCosts'),
    getLocale(),
    getFormatter(),
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
      <h1 className="text-2xl font-semibold">{t('saved')}</h1>
      <p>
        {t('savedBy', {
          actor: data.submitted_by === context.userId ? t('you') : data.submitted_by,
          time: format.dateTime(new Date(data.created_at), 'long'),
        })}
      </p>
      <p>{t('immutable')}</p>
      <PurchaseCostReport report={report} locale={locale} />
      <Link
        className="inline-block underline"
        href={`/replenishment/costs/new?delivery=${report.source.delivery_id}`}
      >
        {t('newFromSource')}
      </Link>
    </div>
  )
}
