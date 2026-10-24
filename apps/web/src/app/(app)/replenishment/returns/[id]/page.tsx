import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getFormatter, getLocale, getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { DealerReturnWithdrawal } from '@/components/dealer-return-form'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { displayName } from '@/lib/format'
import { dealerReturnsPath, dealerReturnReportSchema } from '@/lib/dealer-returns'
export default async function DealerReturnDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!z.guid().safeParse(id).success) notFound()
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const [db, t, messages, locale, format] = await Promise.all([
    createClient(),
    getTranslations('DealerReturns'),
    getMessages(),
    getLocale(),
    getFormatter(),
  ])
  const { data, error } = await db
    .from('dealer_return_requests')
    .select('id,report,submitted_by,created_at,withdrawn_at,withdrawal_reason')
    .eq('organization_id', context.active.id)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error('Return request unavailable')
  if (!data) notFound()
  const report = dealerReturnReportSchema.parse(data.report)
  const details = [
    ['item_code', `${report.item.code} · ${displayName(report.item, locale).primary}`],
    ['source_code', `${report.source.code} · ${displayName(report.source, locale).primary}`],
    ['location_code', `${report.receiver.code} · ${displayName(report.receiver, locale).primary}`],
    ['quantity', `${report.input.quantity} ${report.input.unit}`],
    ['requested_date', report.input.requested_date],
    ['condition', t(report.input.condition)],
    ['reason', report.input.reason],
    ['sale_reference', report.input.sale_reference ?? t('notSupplied')],
  ] as const
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('detail')}
        description={t(data.withdrawn_at ? 'withdrawn' : 'requested')}
        back={
          <Link href={dealerReturnsPath} className="underline">
            {t('title')}
          </Link>
        }
        help={
          <HelpDisclosure>
            <p>{t('limits')}</p>
            <p>{t('corrections')}</p>
          </HelpDisclosure>
        }
      />
      <dl className="grid min-w-0 gap-4 workspace-panel sm:grid-cols-2 lg:grid-cols-3">
        {details.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t(label)}</dt>
            <dd className="break-words text-evidence-value">
              <bdi>{value}</bdi>
            </dd>
          </div>
        ))}
      </dl>
      <section className="space-y-3 workspace-panel">
        <h2 className="text-section-title">{t('history')}</h2>
        <p className="break-words">
          {t('created')}: {format.dateTime(new Date(data.created_at), 'long')} ·{' '}
          {report.author ?? t('notSupplied')}
        </p>
        {data.withdrawn_at && (
          <p className="break-words">
            {t('withdrawn')}: {format.dateTime(new Date(data.withdrawn_at), 'long')} ·{' '}
            {data.withdrawal_reason}
          </p>
        )}
        <p className="break-all text-xs text-muted-foreground">
          {t('identifier')}: {data.id}
        </p>
      </section>
      {data.submitted_by === context.userId && !data.withdrawn_at && (
        <NextIntlClientProvider messages={{ DealerReturns: messages.DealerReturns }}>
          <DealerReturnWithdrawal organizationId={context.active.id} returnId={data.id} />
        </NextIntlClientProvider>
      )}
    </div>
  )
}
