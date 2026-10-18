import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { EventDeliveryForm } from '@/components/event-delivery-form'
import { eventSupplierReportSchema } from '@/lib/event-suppliers'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'

export default async function NewEventDelivery({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { scenario: sourceId } = await searchParams
  if (!z.guid().safeParse(sourceId).success) notFound()
  const [db, t, messages] = await Promise.all([
    createClient(),
    getTranslations('EventDeliveries'),
    getMessages(),
  ])
  const { data, error } = await db
    .from('event_supplier_scenarios')
    .select('report')
    .eq('organization_id', context.active.id)
    .eq('id', sourceId!)
    .maybeSingle()
  if (error) throw new Error('Event replenishment source unavailable')
  if (!data) notFound()
  const report = eventSupplierReportSchema.parse(data.report)
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('new')}
        description={<span className="break-words">{report.draft.scenario.event.input.name}</span>}
        actions={
          <>
            <Link className="underline" href={`/replenishment/events/suppliers/${sourceId}`}>
              {t('source')}
            </Link>
            <Link
              className="underline"
              href={`/replenishment/events/deliveries?scenario=${sourceId}`}
            >
              {t('history')}
            </Link>
          </>
        }
      />
      <p className="text-sm">
        <bdi>
          {report.draft.scenario.event.source.item_code} ·{' '}
          {report.draft.scenario.event.source.location_code} ·{' '}
          {report.draft.scenario.event.input.unit}
        </bdi>{' '}
        · {t('cutoff', { date: report.draft.scenario.event.source.cutoff })}
      </p>
      {isEditorRole(context.role) ? (
        <NextIntlClientProvider
          messages={{
            EventDeliveries: messages.EventDeliveries,
            EventSuppliers: messages.EventSuppliers,
            DeliveryScenarios: messages.DeliveryScenarios,
            EventReplenishment: messages.EventReplenishment,
            Common: messages.Common,
          }}
        >
          <EventDeliveryForm
            organizationId={context.active.id}
            scenarioId={sourceId!}
            cutoff={report.draft.scenario.event.source.cutoff}
            requestId={crypto.randomUUID()}
          />
        </NextIntlClientProvider>
      ) : (
        <p>{t('readOnly')}</p>
      )}
    </div>
  )
}
