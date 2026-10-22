import { isEditorRole } from '@/lib/auth/roles'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { RegionalDateReport } from '@/components/regional-date-report'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { regionalDateReportSchema } from '@/lib/regional-dates'

export default async function SavedRegionalDates({
  params,
}: {
  params: Promise<{ scenarioId: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { scenarioId } = await params
  if (!z.guid().safeParse(scenarioId).success) notFound()
  const [db, t, format] = await Promise.all([
    createClient(),
    getTranslations('RegionalDates'),
    getFormatter(),
  ])
  const result = await db
    .from('regional_date_scenarios')
    .select('report,created_at')
    .eq('organization_id', context.active.id)
    .eq('id', scenarioId)
    .maybeSingle()
  if (result.error) throw new Error('Regional sourcing unavailable')
  if (!result.data) notFound()
  const report = regionalDateReportSchema.parse(result.data.report)
  const freight = await getTranslations('RegionalFreight')
  return (
    <div className="min-w-0 space-y-4 wrap-anywhere">
      <PageHeader
        pattern="replenishment"
        title={t('saved')}
        actions={
          <>
            <Link
              className="underline"
              href={`/replenishment/regional-stock/sourcing/freight?scenario=${scenarioId}`}
            >
              {freight('title')}
            </Link>
            {isEditorRole(context.role) && (
              <Link
                className="rounded-md bg-primary px-3 py-2 text-primary-foreground"
                href={`/replenishment/regional-stock/sourcing/freight/new?scenario=${scenarioId}`}
              >
                {freight('new')}
              </Link>
            )}
          </>
        }
        description={`${report.source.destination.policy?.item_code} · ${report.source.destination.policy.location_code} · ${report.source.destination.policy?.cutoff}`}
        back={
          <Link
            className="inline-block underline"
            href="/replenishment/regional-stock/sourcing/dates"
          >
            {t('back')}
          </Link>
        }
      />
      <p className="text-sm text-muted-foreground">
        {t('savedAt', { time: format.dateTime(new Date(result.data.created_at), 'long') })}
      </p>
      <RegionalDateReport report={report} />
      <Link
        className="inline-block underline"
        href={`/replenishment/regional-stock/sourcing/dates/new?sourcing=${report.sourcing_id}`}
      >
        {t('another')}
      </Link>
    </div>
  )
}
