import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { EventReplenishmentForm } from '@/components/event-replenishment-form'
import { eventPolicyReportSchema } from '@/lib/event-policies'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'

export default async function NewEventDraft({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { scenario } = await searchParams
  if (!z.guid().safeParse(scenario).success) notFound()
  const [db, t, messages] = await Promise.all([
    createClient(),
    getTranslations('EventReplenishment'),
    getMessages(),
  ])
  const { data, error } = await db
    .from('event_policy_scenarios')
    .select('report')
    .eq('organization_id', context.active.id)
    .eq('id', scenario!)
    .maybeSingle()
  if (error) throw new Error('Event replenishment source unavailable')
  if (!data) notFound()
  const report = eventPolicyReportSchema.parse(data.report)
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('new')}
        description={<span className="break-words">{report.event.input.name}</span>}
        actions={
          <>
            <Link className="underline" href={`/forecasts/events/policies/${scenario}`}>
              {t('source')}
            </Link>
            <Link className="underline" href={`/replenishment/events?scenario=${scenario}`}>
              {t('history')}
            </Link>
          </>
        }
      />
      <p className="text-sm">
        <bdi>
          {report.event.source.item_code} · {report.event.source.location_code} ·{' '}
          {report.event.input.unit}
        </bdi>{' '}
        · {t('cutoff', { date: report.event.source.cutoff })}
      </p>
      {isEditorRole(context.role) ? (
        <NextIntlClientProvider
          messages={{ EventReplenishment: messages.EventReplenishment, Common: messages.Common }}
        >
          <EventReplenishmentForm
            organizationId={context.active.id}
            scenarioId={scenario!}
            requestId={crypto.randomUUID()}
          />
        </NextIntlClientProvider>
      ) : (
        <p>{t('readOnly')}</p>
      )}
    </div>
  )
}
