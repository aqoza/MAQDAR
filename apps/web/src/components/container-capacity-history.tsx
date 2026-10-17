import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'

export async function ContainerCapacityHistory({
  organizationId,
  batchId,
  pageValue,
}: {
  organizationId: string
  batchId: string
  pageValue?: string | string[]
}) {
  const [db, t, format] = await Promise.all([
    createClient(),
    getTranslations('ContainerCapacity'),
    getFormatter(),
  ])
  const page = Math.max(
    1,
    Math.min(
      100000,
      Number.parseInt(Array.isArray(pageValue) ? pageValue[0] : (pageValue ?? '1'), 10) || 1,
    ),
  )
  const count = await db
    .from('container_capacity_scenarios')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('batch_id', batchId)
  if (count.error) throw new Error('Capacity history unavailable')
  const pages = Math.max(1, Math.ceil((count.count ?? 0) / 25))
  const current = Math.min(page, pages)
  const rows = await db
    .from('container_capacity_scenarios')
    .select('id,created_at')
    .eq('organization_id', organizationId)
    .eq('batch_id', batchId)
    .order('created_at', { ascending: false })
    .order('id')
    .range((current - 1) * 25, current * 25 - 1)
  if (rows.error) throw new Error('Capacity history unavailable')
  return (
    <section className="space-y-3 workspace-panel">
      <h2 className="text-section-title">{t('history')}</h2>
      {rows.data.length ? (
        <ul className="space-y-2">
          {rows.data.map((row) => (
            <li key={row.id}>
              <Link className="underline" href={`/replenishment/capacity/${row.id}`}>
                {t('savedAt', { time: format.dateTime(new Date(row.created_at), 'long') })}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p>{t('empty')}</p>
      )}
      {pages > 1 && (
        <div className="flex flex-wrap gap-4">
          <span>{t('historyPage', { page: current, pages })}</span>
          {current > 1 && (
            <Link
              className="underline"
              href={`/replenishment/batches/${batchId}?capacity_page=${current - 1}`}
            >
              {t('previous')}
            </Link>
          )}
          {current < pages && (
            <Link
              className="underline"
              href={`/replenishment/batches/${batchId}?capacity_page=${current + 1}`}
            >
              {t('next')}
            </Link>
          )}
        </div>
      )}
    </section>
  )
}
