import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { ContainerCapacityReport } from '@/components/container-capacity-report'
import { capacityReportSchema } from '@/lib/container-capacity'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'

export default async function CapacityDetail({
  params,
}: {
  params: Promise<{ scenarioId: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { scenarioId } = await params
  if (!z.guid().safeParse(scenarioId).success) notFound()
  const [db, t, format] = await Promise.all([
    createClient(),
    getTranslations('ContainerCapacity'),
    getFormatter(),
  ])
  const saved = await db
    .from('container_capacity_scenarios')
    .select('batch_id,report,created_at')
    .eq('organization_id', context.active.id)
    .eq('id', scenarioId)
    .maybeSingle()
  if (saved.error) throw new Error('Capacity scenario unavailable')
  if (!saved.data) notFound()
  const current = await db
    .from('purchase_handoff_batch_list')
    .select('selected')
    .eq('organization_id', context.active.id)
    .eq('id', saved.data.batch_id)
    .maybeSingle()
  if (current.error) throw new Error('Batch selection unavailable')
  const report = capacityReportSchema.parse(saved.data.report)
  return (
    <div className="space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('title')}
        description={t('description')}
        actions={
          <Link className="underline" href={`/replenishment/batches/${saved.data.batch_id}`}>
            {t('source')}
          </Link>
        }
      />
      <p className="text-xs text-muted-foreground">
        {t('savedAt', { time: format.dateTime(new Date(saved.data.created_at), 'long') })}
      </p>
      <p role="status">{t(current.data?.selected ? 'current' : 'historical')}</p>
      <ContainerCapacityReport report={report} />
    </div>
  )
}
