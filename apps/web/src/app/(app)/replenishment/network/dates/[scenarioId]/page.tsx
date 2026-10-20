import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { NetworkDateReport } from '@/components/network-date-report'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { networkDateReportSchema } from '@/lib/network-dates'

export default async function SavedNetworkDates({
  params,
}: {
  params: Promise<{ scenarioId: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { scenarioId } = await params
  if (!z.guid().safeParse(scenarioId).success) notFound()
  const [db, t, locale, format] = await Promise.all([
    createClient(),
    getTranslations('NetworkDates'),
    getLocale(),
    getFormatter(),
  ])
  const result = await db
    .from('network_date_scenarios')
    .select('report,created_at')
    .eq('organization_id', context.active.id)
    .eq('id', scenarioId)
    .maybeSingle()
  if (result.error) throw new Error('Network allocation unavailable')
  if (!result.data) notFound()
  const report = networkDateReportSchema.parse(result.data.report)
  return (
    <div className="min-w-0 space-y-4 wrap-anywhere">
      <PageHeader
        pattern="replenishment"
        title={t('saved')}
        description={`${report.source.source_policy?.item_code} · ${report.source.source_location_code} · ${report.source.source_policy?.cutoff}`}
        back={
          <Link className="inline-block underline" href="/replenishment/network/dates">
            {t('back')}
          </Link>
        }
      />
      <p className="text-sm text-muted-foreground">
        {t('savedAt', { time: format.dateTime(new Date(result.data.created_at), 'long') })}
      </p>
      <p>{t('noGuarantee')}</p>
      <NetworkDateReport report={report} locale={locale} />
      <Link
        className="inline-block underline"
        href={`/replenishment/network/dates/new?allocation=${report.allocation_id}`}
      >
        {t('another')}
      </Link>
    </div>
  )
}
