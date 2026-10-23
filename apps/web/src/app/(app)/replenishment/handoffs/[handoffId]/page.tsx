import { isEditorRole } from '@/lib/auth/roles'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { HandoffAcknowledgements } from '@/components/handoff-acknowledgements'
import Link from 'next/link'
import { HandoffBatchOverlap } from '@/components/handoff-batch-overlap'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { handoffPayloadSchema } from '@/lib/purchase-handoffs'
import { purchaseCostReportSchema } from '@/lib/purchase-costs'
import { PurchaseCostReport } from '@/components/purchase-cost-report'

export default async function HandoffDetail({
  params,
  searchParams,
}: {
  params: Promise<{ handoffId: string }>
  searchParams: Promise<{ ack_page?: string | string[] }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { handoffId } = await params
  if (!z.guid().safeParse(handoffId).success) notFound()
  const [db, t, locale, format] = await Promise.all([
    createClient(),
    getTranslations('PurchaseHandoffs'),
    getLocale(),
    getFormatter(),
  ])
  const [record, current] = await Promise.all([
    db
      .from('purchase_handoffs')
      .select('payload')
      .eq('organization_id', context.active.id)
      .eq('id', handoffId)
      .maybeSingle(),
    db
      .from('purchase_handoff_list')
      .select('selected')
      .eq('organization_id', context.active.id)
      .eq('id', handoffId)
      .maybeSingle(),
  ])
  if (record.error || current.error) throw new Error('Handoff unavailable')
  if (!record.data || !current.data) notFound()
  const payload = handoffPayloadSchema.parse(record.data.payload)
  const price = await db.rpc('purchase_cost_preview', {
    p_organization_id: context.active.id,
    p_delivery_id: payload.estimate.source.delivery_id,
    p_price_confirmed: true,
  })
  // A transient preview failure must not hide a saved export or imply its price still matches.
  const parsed = price.error ? null : purchaseCostReportSchema.safeParse(price.data)
  const priceState = !parsed?.success
    ? 'priceUnknown'
    : parsed.data.status === 'available' && parsed.data.fingerprint === payload.estimate.fingerprint
      ? 'priceCurrent'
      : 'priceChanged'
  return (
    <div className="space-y-4">
      <PageHeader
        pattern="replenishment"
        back={
          <Link className="underline" href="/replenishment/handoffs">
            {t('back')}
          </Link>
        }
        actions={
          isEditorRole(context.role) ? (
            <Link href={`/replenishment/handoffs/${handoffId}/publish`} className="underline">
              {(await getTranslations('SupplierPortal'))('publishTitle')}
            </Link>
          ) : null
        }
        title={t('detailTitle', { item: payload.estimate.source.item_code })}
      />
      <p>{t('description')}</p>

      <p>{t('savedAt', { time: format.dateTime(new Date(payload.created_at), 'long') })}</p>
      <p className="break-all">{t('identity', { id: payload.handoff_id })}</p>
      <section className="space-y-2 workspace-panel" aria-label={t('currentContext')}>
        <h2 className="text-section-title">{t('currentContext')}</h2>
        <p role="status">{t(current.data.selected ? 'current' : 'historical')}</p>
        <p>{t(priceState)}</p>
        <p>{t('immutableNote')}</p>
      </section>
      <div className="flex flex-wrap gap-4">
        <a download href={`/api/purchase-handoffs/${handoffId}/json`} className="underline">
          {t('json')}
        </a>
        <a download href={`/api/purchase-handoffs/${handoffId}/csv`} className="underline">
          {t('csv')}
        </a>
        <Link href={`/replenishment/review/${payload.proposal.id}`} className="underline">
          {t('proposal')}
        </Link>
        <Link href={`/replenishment/costs/${payload.proposal.estimate_id}`} className="underline">
          {t('estimate')}
        </Link>
      </div>
      <HelpDisclosure>
        <p>{t('csvNote')}</p>
      </HelpDisclosure>
      <PurchaseCostReport report={payload.estimate} locale={locale} />
      <HandoffAcknowledgements
        organizationId={context.active.id}
        recordId={handoffId}
        pageValue={(await searchParams).ack_page}
      />
      <HandoffBatchOverlap organizationId={context.active.id} handoffIds={[handoffId]} />
    </div>
  )
}
