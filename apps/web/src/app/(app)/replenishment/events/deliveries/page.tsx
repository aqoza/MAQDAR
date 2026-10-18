import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { isEditorRole } from '@/lib/auth/roles'

export default async function EventDeliveryHistory({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string; page?: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { scenario, page } = await searchParams
  if (!z.guid().safeParse(scenario).success) notFound()
  const [db, t, format, locale] = await Promise.all([
    createClient(),
    getTranslations('EventDeliveries'),
    getFormatter(),
    getLocale(),
  ])
  const source = await db
    .from('event_supplier_scenarios')
    .select('name:report->draft->scenario->event->input->>name')
    .eq('organization_id', context.active.id)
    .eq('id', scenario!)
    .maybeSingle()
  if (source.error) throw new Error('Event source unavailable')
  if (!source.data) notFound()
  const count = await db
    .from('event_delivery_scenarios')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', context.active.id)
    .eq('supplier_scenario_id', scenario!)
  if (count.error) throw new Error('Event delivery history unavailable')
  const pages = Math.max(1, Math.ceil((count.count ?? 0) / 25))
  const current = Math.min(pages, Math.max(1, Number.parseInt(page ?? '1', 10) || 1))
  const rows = await db
    .from('event_delivery_scenarios')
    .select(
      'id,created_at,quantity:report->source->adjusted->>quantity,unit:report->source->draft->scenario->event->input->>unit,receipt:report->>receipt_date',
    )
    .eq('organization_id', context.active.id)
    .eq('supplier_scenario_id', scenario!)
    .order('created_at', { ascending: false })
    .order('id')
    .range((current - 1) * 25, current * 25 - 1)
  if (rows.error) throw new Error('Event delivery history unavailable')
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('history')}
        description={<span className="break-words">{source.data.name}</span>}
        actions={
          <>
            <Link className="underline" href={`/replenishment/events/suppliers/${scenario}`}>
              {t('source')}
            </Link>
            {isEditorRole(context.role) && (
              <Link
                className="underline"
                href={`/replenishment/events/deliveries/new?scenario=${scenario}`}
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
                href={`/replenishment/events/deliveries/${row.id}`}
              >
                {t('historyQuantity', {
                  receipt: row.receipt ?? t('noOrder'),
                  quantity: new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(
                    row.quantity as unknown as number,
                  ),
                  unit: row.unit ?? '',
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
            href={`/replenishment/events/deliveries?scenario=${scenario}&page=${current - 1}`}
          >
            {t('previous')}
          </Link>
        )}
        <span>{t('page', { page: current, pages })}</span>
        {current < pages && (
          <Link
            className="underline"
            href={`/replenishment/events/deliveries?scenario=${scenario}&page=${current + 1}`}
          >
            {t('next')}
          </Link>
        )}
      </nav>
    </div>
  )
}
