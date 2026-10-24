import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { returnBatchesPath } from '@/lib/dealer-return-batches'

export async function DealerReturnBatchOverlap({
  organizationId,
  handoffIds,
  excludeId,
}: {
  organizationId: string
  handoffIds: string[]
  excludeId?: string
}) {
  if (!handoffIds.length) return null
  const [db, t] = await Promise.all([createClient(), getTranslations('DealerReturnBatches')])
  let query = db
    .from('dealer_return_batches')
    .select('id,created_at', { count: 'exact' })
    .eq('organization_id', organizationId)
    .overlaps('handoff_ids', handoffIds)
  if (excludeId) query = query.neq('id', excludeId)
  const result = await query.order('created_at', { ascending: false }).order('id').limit(10)
  if (result.error) throw new Error('Return batch overlap unavailable')
  if (!result.count) return null
  return (
    <section className="space-y-2 workspace-panel">
      <h2 className="text-section-title">{t('overlap')}</h2>
      <p>{t('overlapNote', { count: result.count })}</p>
      <ul className="space-y-1">
        {result.data?.map((row) => (
          <li key={row.id}>
            <Link
              prefetch={false}
              className="inline-flex min-h-11 items-center break-all underline"
              href={returnBatchesPath + '/' + row.id}
            >
              {row.id}
            </Link>
          </li>
        ))}
      </ul>
      {(result.count ?? 0) > 10 && <p className="text-xs">{t('latestOverlap')}</p>}
    </section>
  )
}
