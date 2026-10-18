import Link from 'next/link'
import { formatPurchaseCost } from '@/lib/purchase-costs'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { isEditorRole } from '@/lib/auth/roles'

export default async function EventCostHistory({
  searchParams,
}: {
  searchParams: Promise<{ delivery?: string; page?: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { delivery, page } = await searchParams
  if (!z.guid().safeParse(delivery).success) notFound()
  const [db, t, format, locale] = await Promise.all([
    createClient(),
    getTranslations('EventCosts'),
    getFormatter(),
    getLocale(),
  ])
  const source = await db
    .from('event_delivery_scenarios')
    .select('name:report->source->draft->scenario->event->input->>name')
    .eq('organization_id', context.active.id)
    .eq('id', delivery!)
    .maybeSingle()
  if (source.error) throw new Error('Event source unavailable')
  if (!source.data) notFound()
  const count = await db
    .from('event_purchase_cost_estimates')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', context.active.id)
    .eq('delivery_id', delivery!)
  if (count.error) throw new Error('Event cost history unavailable')
  const pages = Math.max(1, Math.ceil((count.count ?? 0) / 25))
  const current = Math.min(pages, Math.max(1, Number.parseInt(page ?? '1', 10) || 1))
  const rows = await db
    .from('event_purchase_cost_estimates')
    .select(
      'id,created_at,status:report->>status,cost:report->>cost_increase,currency:report->price->>currency,digits:report->price->minor_units',
    )
    .eq('organization_id', context.active.id)
    .eq('delivery_id', delivery!)
    .order('created_at', { ascending: false })
    .order('id')
    .range((current - 1) * 25, current * 25 - 1)
  if (rows.error) throw new Error('Event cost history unavailable')
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('history')}
        description={<span className="break-words">{source.data.name}</span>}
        actions={
          <>
            <Link className="underline" href={`/replenishment/events/deliveries/${delivery}`}>
              {t('source')}
            </Link>
            {isEditorRole(context.role) && (
              <Link
                className="underline"
                href={`/replenishment/events/costs/new?delivery=${delivery}`}
              >
                {t('new')}
              </Link>
            )}
          </>
        }
      />
      <p className="text-sm text-muted-foreground">{t('historyNote')}</p>
      {rows.data.length ? (
        <ul className="space-y-3">
          {rows.data.map((row) => (
            <li key={row.id} className="space-y-2 workspace-panel">
              <Link
                className="break-words underline"
                href={`/replenishment/events/costs/${row.id}`}
              >
                {t('historyCost', {
                  cost:
                    row.status === 'no_order_needed'
                      ? t('noOrder')
                      : formatPurchaseCost(
                          row.cost,
                          row.currency,
                          row.digits as number | null,
                          locale,
                        ),
                })}
              </Link>
              <p className="text-xs text-muted-foreground">
                {t('savedAt', { time: format.dateTime(new Date(row.created_at), 'long') })}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p>{t('empty')}</p>
      )}
      <nav aria-label={t('pagination')} className="flex flex-wrap gap-4">
        {current > 1 && (
          <Link
            className="underline"
            href={`/replenishment/events/costs?delivery=${delivery}&page=${current - 1}`}
          >
            {t('previous')}
          </Link>
        )}
        <span>{t('page', { page: current, pages })}</span>
        {current < pages && (
          <Link
            className="underline"
            href={`/replenishment/events/costs?delivery=${delivery}&page=${current + 1}`}
          >
            {t('next')}
          </Link>
        )}
      </nav>
    </div>
  )
}
