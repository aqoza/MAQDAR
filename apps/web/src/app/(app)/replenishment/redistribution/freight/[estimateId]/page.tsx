import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getLocale, getTranslations, getMessages } from 'next-intl/server'
import { NextIntlClientProvider } from 'next-intl'
import { TransferProposalForm } from '@/components/transfer-review-forms'
import { isEditorRole } from '@/lib/auth/roles'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { TransferFreightReport } from '@/components/transfer-freight-report'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { transferFreightReportSchema } from '@/lib/transfer-freight'

export default async function SavedTransferFreight({
  params,
}: {
  params: Promise<{ estimateId: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { estimateId } = await params
  if (!z.uuid().safeParse(estimateId).success) notFound()
  const [db, t, locale, format, review, messages] = await Promise.all([
    createClient(),
    getTranslations('TransferFreight'),
    getLocale(),
    getFormatter(),
    getTranslations('TransferReview'),
    getMessages(),
  ])
  const result = await db
    .from('transfer_freight_estimates')
    .select('report,created_at')
    .eq('organization_id', context.active.id)
    .eq('id', estimateId)
    .maybeSingle()
  if (result.error) throw new Error('Transfer date scenario unavailable')
  if (!result.data) notFound()
  const report = transferFreightReportSchema.parse(result.data.report)
  return (
    <div className="min-w-0 space-y-4 wrap-anywhere">
      <Link className="inline-block underline" href="/replenishment/redistribution/freight">
        {t('back')}
      </Link>
      <PageHeader
        title={t('saved')}
        description={`${report.source.source.destination.policy.item_code} · ${report.source.source.source_location_code} → ${report.source.source.destination.policy.location_code} · ${report.source.source.destination.policy.cutoff}`}
      />
      <p className="text-sm text-muted-foreground">
        {t('savedAt', { time: format.dateTime(new Date(result.data.created_at), 'long') })}
      </p>
      <p>{t('noGuarantee')}</p>
      <TransferFreightReport report={report} locale={locale} />
      <Link
        className="inline-block underline"
        href={`/replenishment/redistribution/review?draft=${report.source.redistribution_id}`}
      >
        {review('draftHistory')}
      </Link>
      {report.status === 'available' && isEditorRole(context.role) && (
        <NextIntlClientProvider messages={{ TransferReview: messages.TransferReview }}>
          <TransferProposalForm
            organizationId={context.active.id}
            estimateId={estimateId}
            requestId={crypto.randomUUID()}
          />
        </NextIntlClientProvider>
      )}
      <Link
        className="inline-block underline"
        href={`/replenishment/redistribution/freight/new?scenario=${report.scenario_id}`}
      >
        {t('another')}
      </Link>
    </div>
  )
}
