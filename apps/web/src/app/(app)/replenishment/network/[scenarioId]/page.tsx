import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { NetworkAllocationReport } from '@/components/network-allocation-report'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { networkReportSchema } from '@/lib/network-allocation'

export default async function SavedNetworkAllocation({
  params,
}: {
  params: Promise<{ scenarioId: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { scenarioId } = await params
  if (!z.guid().safeParse(scenarioId).success) notFound()
  const [db, t, locale, dates] = await Promise.all([
    createClient(),
    getTranslations('NetworkAllocation'),
    getLocale(),
    getTranslations('NetworkDates'),
  ])
  const result = await db
    .from('network_allocation_scenarios')
    .select('report,created_at')
    .eq('organization_id', context.active.id)
    .eq('id', scenarioId)
    .maybeSingle()
  if (result.error) throw new Error('Allocation unavailable')
  if (!result.data) notFound()
  const report = networkReportSchema.parse(result.data.report)
  return (
    <div className="min-w-0 space-y-4 wrap-anywhere">
      <PageHeader
        pattern="replenishment"
        title={t('saved')}
        description={`${report.source_location_code} · ${report.source_policy?.item_code} · ${report.source_policy?.cutoff}`}
        back={
          <Link className="underline" href="/replenishment/network">
            {t('back')}
          </Link>
        }
        actions={
          <>
            <Link className="underline" href="/replenishment/network/new">
              {t('create')}
            </Link>
            <Link
              className="underline"
              href={`/replenishment/network/dates/new?allocation=${scenarioId}`}
            >
              {dates('new')}
            </Link>
            <Link
              className="underline"
              href={`/replenishment/network/dates?allocation=${scenarioId}`}
            >
              {dates('dateHistory')}
            </Link>
          </>
        }
      />
      <p className="text-sm text-muted-foreground">{t('planningOnly')}</p>
      <NetworkAllocationReport report={report} locale={locale} />
    </div>
  )
}
