import { PageHeader } from '@/components/page-header'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { SupplierScenarioReport } from '@/components/supplier-scenario-report'
import { DeliveryScenarioHistory } from '@/components/delivery-scenario-history'
import type { RawSearchParams } from '@/lib/master-data/list-params'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { supplierScenarioReportSchema } from '@/lib/supplier-scenarios'

export default async function SavedSupplierScenario({
  params,
  searchParams,
}: {
  params: Promise<{ scenarioId: string }>
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { scenarioId } = await params
  if (!z.guid().safeParse(scenarioId).success) notFound()
  const [db, t, locale, format] = await Promise.all([
    createClient(),
    getTranslations('SupplierScenarios'),
    getLocale(),
    getFormatter(),
  ])
  const { data, error } = await db
    .from('supplier_scenarios')
    .select('report,created_at,submitted_by')
    .eq('organization_id', context.active.id)
    .eq('id', scenarioId)
    .maybeSingle()
  if (error) throw new Error('Supplier scenario unavailable')
  if (!data) notFound()
  const report = supplierScenarioReportSchema.parse(data.report)
  const explain = await getTranslations('SupplierExplainer')
  return (
    <div className="space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('saved')}
        actions={
          report.status === 'available' ? (
            <Link
              className="underline"
              href={`/replenishment/suppliers/explanations/new?scenario=${scenarioId}`}
            >
              {explain('action')}
            </Link>
          ) : undefined
        }
      />
      <p>
        {t('savedBy', {
          actor: data.submitted_by === context.userId ? t('you') : data.submitted_by,
          time: format.dateTime(new Date(data.created_at), 'long'),
        })}
      </p>

      <p>{t('immutable')}</p>
      <SupplierScenarioReport report={report} locale={locale} />
      {report.status === 'available' && (
        <Link
          className="inline-block underline"
          href={`/replenishment/deliveries/new?scenario=${scenarioId}`}
        >
          {t('deliveryScenario')}
        </Link>
      )}
      <DeliveryScenarioHistory
        organizationId={context.active.id}
        scenarioId={scenarioId}
        raw={await searchParams}
      />
      <Link
        className="inline-block underline"
        href={`/replenishment/suppliers/new?draft=${report.source.draft_id}&supplier=${encodeURIComponent(report.requested_supplier_code)}`}
      >
        {t('newFromDraft')}
      </Link>
    </div>
  )
}
