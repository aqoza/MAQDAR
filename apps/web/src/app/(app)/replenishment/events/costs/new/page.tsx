import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { EventCostForm } from '@/components/event-cost-form'
import { eventDeliveryReportSchema } from '@/lib/event-deliveries'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'

export default async function NewEventCost({
  searchParams,
}: {
  searchParams: Promise<{ delivery?: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { delivery: sourceId } = await searchParams
  if (!z.guid().safeParse(sourceId).success) notFound()
  const [db, t, messages] = await Promise.all([
    createClient(),
    getTranslations('EventCosts'),
    getMessages(),
  ])
  const { data, error } = await db
    .from('event_delivery_scenarios')
    .select('report')
    .eq('organization_id', context.active.id)
    .eq('id', sourceId!)
    .maybeSingle()
  if (error) throw new Error('Event delivery source unavailable')
  if (!data) notFound()
  const report = eventDeliveryReportSchema.parse(data.report)
  return (
    <div className="space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('new')}
        description={
          <span className="break-words">{report.source.draft.scenario.event.input.name}</span>
        }
        actions={
          <>
            <Link className="underline" href={`/replenishment/events/deliveries/${sourceId}`}>
              {t('source')}
            </Link>
            <Link className="underline" href={`/replenishment/events/costs?delivery=${sourceId}`}>
              {t('history')}
            </Link>
          </>
        }
      />
      <p className="text-sm">
        <bdi>
          {report.source.draft.scenario.event.source.item_code} ·{' '}
          {report.source.draft.scenario.event.source.location_code} ·{' '}
          {report.source.draft.scenario.event.input.unit}
        </bdi>{' '}
        · {t('cutoff', { date: report.source.draft.scenario.event.source.cutoff })}
      </p>
      {isEditorRole(context.role) ? (
        <NextIntlClientProvider
          messages={{
            EventCosts: messages.EventCosts,
            EventDeliveries: messages.EventDeliveries,
            EventSuppliers: messages.EventSuppliers,
            DeliveryScenarios: messages.DeliveryScenarios,
            EventReplenishment: messages.EventReplenishment,
            Common: messages.Common,
          }}
        >
          <EventCostForm
            organizationId={context.active.id}
            deliveryId={sourceId!}
            requestId={crypto.randomUUID()}
          />
        </NextIntlClientProvider>
      ) : (
        <p>{t('readOnly')}</p>
      )}
    </div>
  )
}
