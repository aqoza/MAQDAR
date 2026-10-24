import Link from 'next/link'
import { HandoffAcknowledgements } from '@/components/handoff-acknowledgements'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { dealerReturnsPath } from '@/lib/dealer-returns'
import { returnHandoffsPath, returnHandoffPayloadSchema } from '@/lib/dealer-return-handoffs'

export default async function ReturnHandoffDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ ack_page?: string | string[] }>
}) {
  const { id } = await params
  if (!z.guid().safeParse(id).success) notFound()
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const [db, t, r, format] = await Promise.all([
    createClient(),
    getTranslations('DealerReturnHandoffs'),
    getTranslations('DealerReturns'),
    getFormatter(),
  ])
  const { data, error } = await db
    .from('dealer_return_handoffs')
    .select('payload')
    .eq('organization_id', context.active.id)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error('Return handoff unavailable')
  if (!data) notFound()
  const p = returnHandoffPayloadSchema.parse(data.payload)
  const report = p.request.report
  const evidence = [
    ['item_code', report.item.code],
    ['source_code', report.source.code],
    ['location_code', report.receiver.code],
    ['quantity', report.input.quantity + ' ' + report.input.unit],
    ['requested_date', report.input.requested_date],
    ['condition', r(report.input.condition)],
    ['reason', report.input.reason],
    ['sale_reference', report.input.sale_reference ?? r('notSupplied')],
  ] as const
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('detail')}
        description={t('description')}
        back={
          <Link className="underline" href={returnHandoffsPath}>
            {t('title')}
          </Link>
        }
        actions={
          <>
            <a className="underline" href={'/api/dealer-return-handoffs/' + id + '/csv'}>
              {t('csv')}
            </a>
            <a className="underline" href={'/api/dealer-return-handoffs/' + id + '/json'}>
              {t('json')}
            </a>
          </>
        }
        help={
          <HelpDisclosure>
            <p>{t('limits')}</p>
            <p>{t('retention')}</p>
          </HelpDisclosure>
        }
      />
      <dl className="grid min-w-0 gap-4 workspace-panel sm:grid-cols-2 lg:grid-cols-3">
        {evidence.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{r(label)}</dt>
            <dd className="break-words text-evidence-value">
              <bdi>{value}</bdi>
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">{t('dateNote')}</p>
      <section className="space-y-3 break-words workspace-panel">
        <h2 className="text-section-title">{t('approval')}</h2>
        <p>
          {format.dateTime(new Date(p.approval.decided_at), 'long')} ·{' '}
          <bdi>{p.approval.reviewer_email ?? r('notSupplied')}</bdi>
        </p>
        <p>
          {r('decisionReason')}: {p.approval.reason}
        </p>
        <p className="text-xs text-muted-foreground">{r('eligibilityRecorded')}</p>
        <Link
          className="inline-flex min-h-11 items-center underline"
          href={dealerReturnsPath + '/' + p.request.id}
        >
          {t('request')}
        </Link>
      </section>
      <section className="space-y-3 break-words workspace-panel">
        <h2 className="text-section-title">{t('history')}</h2>
        <p>
          {t('requestCreated')}: {format.dateTime(new Date(p.request.created_at), 'long')} ·{' '}
          <bdi>{report.author ?? r('notSupplied')}</bdi>
        </p>
        <p>
          {t('created')}: {format.dateTime(new Date(p.created_at), 'long')} ·{' '}
          <bdi>{p.created_by_email ?? r('notSupplied')}</bdi>
        </p>
        <p className="break-all text-xs text-muted-foreground">
          {t('identifier')}: {p.handoff_id}
        </p>
      </section>
      <HandoffAcknowledgements
        organizationId={context.active.id}
        recordId={id}
        kind="return"
        pageValue={(await searchParams).ack_page}
      />
    </div>
  )
}
