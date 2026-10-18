import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { EventPolicyForm } from '@/components/event-policy-form'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'

const optionsSchema = z.object({
  lead_time: z.number(),
  review_interval: z.number(),
  service_level: z.string(),
})
export default async function NewEventPolicy({
  searchParams,
}: {
  searchParams: Promise<{ event?: string; policy?: string; page?: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { event, policy, page } = await searchParams
  if (!z.uuid().safeParse(event).success || (policy && !z.uuid().safeParse(policy).success))
    notFound()
  const [db, t, messages] = await Promise.all([
    createClient(),
    getTranslations('EventPolicies'),
    getMessages(),
  ])
  const source = await db
    .from('planned_event_scenarios')
    .select('id,name,forecast_id')
    .eq('organization_id', context.active.id)
    .eq('id', event!)
    .maybeSingle()
  if (source.error) throw new Error('Event policy source unavailable')
  if (!source.data) notFound()
  let selected: { id: string; options: unknown } | null = null
  if (policy) {
    const result = await db
      .from('inventory_policies')
      .select('id,options:evidence->options')
      .eq('organization_id', context.active.id)
      .eq('forecast_id', source.data.forecast_id)
      .eq('id', policy)
      .maybeSingle()
    if (result.error) throw new Error('Event policy unavailable')
    if (!result.data) notFound()
    selected = result.data
  }
  const count = await db
    .from('inventory_policies')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', context.active.id)
    .eq('forecast_id', source.data.forecast_id)
    .eq('status', 'available')
  if (count.error) throw new Error('Event policy choices unavailable')
  const pages = Math.max(1, Math.ceil((count.count ?? 0) / 25))
  const current = Math.min(pages, Math.max(1, Number.parseInt(page ?? '1', 10) || 1))
  const choices = selected
    ? null
    : await db
        .from('inventory_policies')
        .select('id,options:evidence->options')
        .eq('organization_id', context.active.id)
        .eq('forecast_id', source.data.forecast_id)
        .eq('status', 'available')
        .order('id')
        .range((current - 1) * 25, current * 25 - 1)
  if (choices?.error) throw new Error('Event policy choices unavailable')
  const selectedOptions = selected ? optionsSchema.parse(selected.options) : null
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('new')}
        description={<span className="break-words">{source.data.name}</span>}
        actions={
          <Link className="underline" href={`/forecasts/events/policies?event=${event}`}>
            {t('history')}
          </Link>
        }
      />
      <p className="text-sm text-muted-foreground">{t('description')}</p>
      {selected && selectedOptions ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 workspace-panel">
            <p className="min-w-0 break-words">
              {t('selected', {
                id: selected.id,
                lead: selectedOptions.lead_time,
                review: selectedOptions.review_interval,
                service: selectedOptions.service_level,
              })}
            </p>
            <Link className="underline" href={`/forecasts/events/policies/new?event=${event}`}>
              {t('changePolicy')}
            </Link>
          </div>
          {isEditorRole(context.role) ? (
            <NextIntlClientProvider
              messages={{ EventPolicies: messages.EventPolicies, Common: messages.Common }}
            >
              <EventPolicyForm
                key={selected.id}
                organizationId={context.active.id}
                eventId={event!}
                policyId={selected.id}
                requestId={crypto.randomUUID()}
              />
            </NextIntlClientProvider>
          ) : (
            <p>{t('readOnly')}</p>
          )}
        </>
      ) : (
        <>
          <h2 className="text-section-title">{t('choose')}</h2>
          {choices?.data?.length ? (
            <TableScrollRegion label={t('choose')}>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    {(['policy', 'leadDays', 'reviewDays', 'service', 'action'] as const).map(
                      (key) => (
                        <th key={key} className="p-3 text-start">
                          {t(key)}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {choices.data.map((row) => {
                    const options = optionsSchema.parse(row.options)
                    return (
                      <tr key={row.id} className="border-t">
                        <td className="p-3">
                          <bdi>{row.id}</bdi>
                        </td>
                        <td className="p-3">{options.lead_time}</td>
                        <td className="p-3">{options.review_interval}</td>
                        <td className="p-3">{options.service_level}</td>
                        <td className="p-3">
                          <Link
                            className="inline-block whitespace-nowrap underline"
                            href={`/forecasts/events/policies/new?event=${event}&policy=${row.id}`}
                          >
                            {t('usePolicy')}
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </TableScrollRegion>
          ) : (
            <p>{t('noPolicies')}</p>
          )}
          <nav aria-label={t('pagination')} className="flex flex-wrap gap-4">
            {current > 1 && (
              <Link
                className="underline"
                href={`/forecasts/events/policies/new?event=${event}&page=${current - 1}`}
              >
                {t('previous')}
              </Link>
            )}
            <span>{t('page', { page: current, pages })}</span>
            {current < pages && (
              <Link
                className="underline"
                href={`/forecasts/events/policies/new?event=${event}&page=${current + 1}`}
              >
                {t('next')}
              </Link>
            )}
          </nav>
          <Link className="underline" href={`/forecasts/events/${event}`}>
            {t('eventSource')}
          </Link>
        </>
      )}
    </div>
  )
}
