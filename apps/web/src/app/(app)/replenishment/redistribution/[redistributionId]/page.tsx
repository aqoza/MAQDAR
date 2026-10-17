import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { RedistributionReport } from '@/components/redistribution-report'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { redistributionReportSchema } from '@/lib/redistribution'

export default async function SavedRedistribution({
  params,
}: {
  params: Promise<{ redistributionId: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { redistributionId } = await params
  if (!z.uuid().safeParse(redistributionId).success) notFound()
  const [db, t, dates, locale, format] = await Promise.all([
    createClient(),
    getTranslations('Redistribution'),
    getTranslations('TransferDates'),
    getLocale(),
    getFormatter(),
  ])
  const result = await db
    .from('redistribution_drafts')
    .select('report,created_at')
    .eq('organization_id', context.active.id)
    .eq('id', redistributionId)
    .maybeSingle()
  if (result.error) throw new Error('Redistribution draft unavailable')
  if (!result.data) notFound()
  const report = redistributionReportSchema.parse(result.data.report)
  return (
    <div className="min-w-0 space-y-4 wrap-anywhere">
      <Link className="inline-block underline" href="/replenishment/redistribution">
        {t('back')}
      </Link>
      <PageHeader
        title={t('saved')}
        description={`${report.destination.policy.item_code} · ${report.source_location_code} → ${report.destination.policy.location_code} · ${report.destination.policy.cutoff}`}
        actions={
          <Link
            className="rounded-md bg-primary px-3 py-2 text-primary-foreground"
            href={`/replenishment/redistribution/dates/new?draft=${redistributionId}`}
          >
            {dates('create')}
          </Link>
        }
      />
      <Link
        className="inline-block underline"
        href={`/replenishment/redistribution/dates?draft=${redistributionId}`}
      >
        {dates('draftHistory')}
      </Link>
      <p className="text-sm text-muted-foreground">
        {t('savedAt', { time: format.dateTime(new Date(result.data.created_at), 'long') })}
      </p>
      <p>{t('noReservation')}</p>
      <RedistributionReport report={report} locale={locale} />
      <Link
        className="inline-block underline"
        href={`/replenishment/redistribution/new?draft=${report.draft_id}`}
      >
        {t('another')}
      </Link>
    </div>
  )
}
