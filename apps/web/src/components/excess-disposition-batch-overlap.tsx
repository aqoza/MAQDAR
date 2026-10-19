import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'

export async function ExcessDispositionBatchOverlap({
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
    getTranslations('ExcessDispositionBatches'),
    getFormatter(),
  ])
  let query = db
    .from('excess_disposition_handoff_batches')
    .select('id,handoff_ids,created_at', { count: 'exact' })
    .eq('organization_id', organizationId)
    .overlaps('handoff_ids', handoffIds)
  if (excludeId) query = query.neq('id', excludeId)
  const result = await query.order('created_at', { ascending: false }).order('id').limit(25)
  if (result.error) throw new Error('Batch overlap unavailable')
  if (!result.count) return null
  return (
    <section className="space-y-2 workspace-panel" aria-label={t('overlap')}>
      <h2 className="text-section-title">{t('overlap')}</h2>
      <p>{t('overlapCount', { total: result.count ?? 0 })}</p>
      <p className="text-xs text-muted-foreground">{t('overlapSummary')}</p>
      <ul className="space-y-2">
        {(result.data ?? []).map((batch) => (
          <li key={batch.id}>
            <Link
              className="break-all underline"
              prefetch={false}
              href={`/replenishment/excess/batches/${batch.id}`}
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
