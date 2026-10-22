import Link from 'next/link'
import { isEditorRole } from '@/lib/auth/roles'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { RegionalFreightReport } from '@/components/regional-freight-report'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { regionalFreightReportSchema } from '@/lib/regional-freight'

export default async function SavedRegionalFreight({
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
    getTranslations('RegionalFreight'),
    getLocale(),
    getFormatter(),
  ])
  const result = await db
    .from('regional_freight_estimates')
    .select('report,created_at')
    .eq('organization_id', context.active.id)
    .eq('id', estimateId)
    .maybeSingle()
  if (result.error) throw new Error('Regional freight unavailable')
  if (!result.data) notFound()
  const report = regionalFreightReportSchema.parse(result.data.report)
  return (
    <div className="min-w-0 space-y-4 wrap-anywhere">
      <PageHeader
        pattern="replenishment"
        title={t('saved')}
        description={`${report.source.source.destination.policy.item_code} · ${report.source.source.destination.policy.location_code} · ${report.source.source.destination.policy.cutoff}`}
        back={
          <Link
            className="inline-block underline"
            href="/replenishment/regional-stock/sourcing/freight"
          >
            {t('back')}
          </Link>
        }
      />
      <p className="text-sm text-muted-foreground">
        {t('savedAt', { time: format.dateTime(new Date(result.data.created_at), 'long') })}
      </p>
      <RegionalFreightReport report={report} locale={locale} />
      {isEditorRole(context.role) && (
        <Link
          className="inline-block underline"
          href={`/replenishment/regional-stock/sourcing/freight/new?scenario=${report.scenario_id}`}
        >
          {t('another')}
        </Link>
      )}
    </div>
  )
}
