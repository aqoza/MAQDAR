import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { NetworkFreightReport } from '@/components/network-freight-report'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { networkFreightReportSchema } from '@/lib/network-freight'

export default async function SavedNetworkFreight({
  params,
}: {
  params: Promise<{ estimateId: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { estimateId } = await params
  if (!z.guid().safeParse(estimateId).success) notFound()
  const [db, t, locale, format] = await Promise.all([
    createClient(),
    getTranslations('NetworkFreight'),
    getLocale(),
    getFormatter(),
  ])
  const result = await db
    .from('network_freight_estimates')
    .select('report,created_at')
    .eq('organization_id', context.active.id)
    .eq('id', estimateId)
    .maybeSingle()
  if (result.error) throw new Error('Network allocation unavailable')
  if (!result.data) notFound()
  const report = networkFreightReportSchema.parse(result.data.report)
  return (
    <div className="min-w-0 space-y-4 wrap-anywhere">
      <PageHeader
        pattern="replenishment"
        title={t('saved')}
        description={`${report.source.source.source_policy?.item_code} · ${report.source.source.source_location_code} · ${report.source.source.source_policy?.cutoff}`}
        back={
          <Link className="inline-block underline" href="/replenishment/network/freight">
            {t('back')}
          </Link>
        }
      />
      <p className="text-sm text-muted-foreground">
        {t('savedAt', { time: format.dateTime(new Date(result.data.created_at), 'long') })}
      </p>
      <p>{t('noGuarantee')}</p>
      <NetworkFreightReport report={report} locale={locale} />
      <Link
        className="inline-block underline"
        href={`/replenishment/network/freight/new?scenario=${report.scenario_id}`}
      >
        {t('another')}
      </Link>
    </div>
  )
}
