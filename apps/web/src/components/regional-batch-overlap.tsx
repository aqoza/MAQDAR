import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'

export async function RegionalBatchOverlap({
  organizationId,
  handoffIds,
  excludeId,
}: {
  organizationId: string
  handoffIds: string[]
  excludeId?: string
}) {
  if (!handoffIds.length) return null
  const [db, t, format] = await Promise.all([
    createClient(),
    getTranslations('RegionalBatches'),
    getFormatter(),
  ])
  let query = db
    .from('regional_handoff_batches')
    .select('id,handoff_ids,created_at', { count: 'exact' })
    .eq('organization_id', organizationId)
    .overlaps('handoff_ids', handoffIds)
  if (excludeId) query = query.neq('id', excludeId)
  const result = await query.order('created_at', { ascending: false }).order('id').limit(25)
  if (result.error) throw new Error('Batch overlap unavailable')
  return (
    <section className="space-y-2 workspace-panel" aria-label={t('overlap')}>
      <h2 className="text-section-title">{t('overlap')}</h2>
      <p>{t('overlapCount', { total: result.count ?? 0 })}</p>
      <p>{t('overlapNote')}</p>
      <ul className="space-y-2">
        {(result.data ?? []).map((batch) => (
          <li key={batch.id}>
            <Link
              className="break-all underline"
              prefetch={false}
              href={`/replenishment/regional-stock/sourcing/batches/${batch.id}`}
            >
              {t('batchIdentity', { id: batch.id })}
            </Link>
            {' · '}
            {t('sharedLines', {
              total: batch.handoff_ids.filter((id) => handoffIds.includes(id)).length,
            })}
            {' · '}
            {format.dateTime(new Date(batch.created_at), 'long')}
          </li>
        ))}
      </ul>
      {(result.count ?? 0) > 25 && <p>{t('overlapLimited')}</p>}
    </section>
  )
}
