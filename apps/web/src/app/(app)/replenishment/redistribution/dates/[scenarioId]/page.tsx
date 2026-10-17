import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { TransferDateReport } from '@/components/transfer-date-report'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { transferDateReportSchema } from '@/lib/transfer-dates'

export default async function SavedTransferDates({
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
    getTranslations('TransferDates'),
    getLocale(),
    getFormatter(),
  ])
  const result = await db
    .from('transfer_date_scenarios')
    .select('report,created_at')
    .eq('organization_id', context.active.id)
    .eq('id', scenarioId)
    .maybeSingle()
  if (result.error) throw new Error('Redistribution draft unavailable')
  if (!result.data) notFound()
  const report = transferDateReportSchema.parse(result.data.report)
  return (
    <div className="min-w-0 space-y-4 wrap-anywhere">
      <Link className="inline-block underline" href="/replenishment/redistribution/dates">
        {t('back')}
      </Link>
      <PageHeader
        title={t('saved')}
        description={`${report.source.destination.policy.item_code} · ${report.source.source_location_code} → ${report.source.destination.policy.location_code} · ${report.source.destination.policy.cutoff}`}
      />
      <p className="text-sm text-muted-foreground">
        {t('savedAt', { time: format.dateTime(new Date(result.data.created_at), 'long') })}
      </p>
      <p>{t('noGuarantee')}</p>
      <TransferDateReport report={report} locale={locale} />
      <Link
        className="inline-block underline"
        href={`/replenishment/redistribution/dates/new?draft=${report.redistribution_id}`}
      >
        {t('another')}
      </Link>
    </div>
  )
}
