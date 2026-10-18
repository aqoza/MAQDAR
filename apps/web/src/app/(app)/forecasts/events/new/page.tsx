import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { PlannedEventForm } from '@/components/planned-event-form'
import { eventSourceSchema, eventSourceStatuses } from '@/lib/planned-events'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'

export default async function NewEvent({
  searchParams,
}: {
  searchParams: Promise<{ forecast?: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { forecast } = await searchParams
  if (!z.guid().safeParse(forecast).success) notFound()
  const [db, t, messages] = await Promise.all([
    createClient(),
    getTranslations('PlannedEvents'),
    getMessages(),
  ])
  const { data, error } = await db.rpc('planned_event_source', {
    p_organization_id: context.active.id,
    p_forecast_id: forecast!,
  })
  if (error?.code === 'MQ404') notFound()
  if (error) throw new Error('Event source unavailable')
  const status = z.object({ status: z.enum(eventSourceStatuses) }).parse(data).status
  const source = status === 'available' ? eventSourceSchema.parse(data) : null
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('new')}
        description={t('description')}
        actions={
          <Link className="underline" href={`/forecasts/events?forecast=${forecast}`}>
            {t('history')}
          </Link>
        }
      />
      {source ? (
        <>
          <p className="break-words">
            <bdi>
              {source.item_code} · {source.location_code} · {source.unit}
            </bdi>
          </p>
          <Link
            className="underline"
            href={`/forecasts/results/${source.run_id}?item=${source.item_id}`}
          >
            {t('source')}
          </Link>
          {isEditorRole(context.role) ? (
            <NextIntlClientProvider
              messages={{ PlannedEvents: messages.PlannedEvents, Common: messages.Common }}
            >
              <PlannedEventForm
                organizationId={context.active.id}
                source={source}
                requestId={crypto.randomUUID()}
              />
            </NextIntlClientProvider>
          ) : (
            <p>{t('readOnly')}</p>
          )}
        </>
      ) : (
        <p role="status">{t(`statuses.${status}`)}</p>
      )}
    </div>
  )
}
