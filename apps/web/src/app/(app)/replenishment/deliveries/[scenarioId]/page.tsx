import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { DeliveryScenarioReport } from '@/components/delivery-scenario-report'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { deliveryScenarioReportSchema } from '@/lib/delivery-scenarios'

export default async function SavedDeliveryScenario({
  params,
}: {
  params: Promise<{ scenarioId: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { scenarioId } = await params
  if (!z.uuid().safeParse(scenarioId).success) notFound()
  const [db, t, locale, format] = await Promise.all([
    createClient(),
    getTranslations('DeliveryScenarios'),
    getLocale(),
    getFormatter(),
  ])
  const { data, error } = await db
    .from('delivery_scenarios')
    .select('report,created_at,submitted_by')
    .eq('organization_id', context.active.id)
    .eq('id', scenarioId)
    .maybeSingle()
  if (error) throw new Error('Delivery scenario unavailable')
  if (!data) notFound()
  const report = deliveryScenarioReportSchema.parse(data.report)
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
      <DeliveryScenarioReport report={report} locale={locale} />
      <Link
        className="inline-block underline"
        href={`/replenishment/deliveries/new?scenario=${report.source.scenario_id}`}
      >
        {t('newFromSource')}
      </Link>
    </div>
  )
}
