import { notFound, redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { ExcessStockHeader } from '@/components/excess-stock-header'
import { ExcessStockReport } from '@/components/excess-stock-report'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { excessReportSchema } from '@/lib/excess-stock'

export async function generateMetadata() {
  return { title: (await getTranslations('ExcessStock'))('assessment') }
}
export default async function Assessment({
  params,
}: {
  params: Promise<{ assessmentId: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { assessmentId } = await params
  if (!z.guid().safeParse(assessmentId).success) notFound()
  const [db, t, format] = await Promise.all([
    createClient(),
    getTranslations('ExcessStock'),
    getFormatter(),
  ])
  const { data, error } = await db
    .from('excess_stock_assessments')
    .select('id,created_at,reason,report')
    .eq('organization_id', context.active.id)
    .eq('id', assessmentId)
    .maybeSingle()
  if (error) throw new Error('Assessment unavailable')
  if (!data) notFound()
  const report = excessReportSchema.parse(data.report)
  return (
    <div className="min-w-0 space-y-4">
      <ExcessStockHeader detail />
      <section className="workspace-panel space-y-2">
        <h2 className="text-section-title">
          {t('savedAt', { time: format.dateTime(new Date(data.created_at), 'long') })}
        </h2>
        <p className="break-words">{data.reason}</p>
        <p className="text-xs text-muted-foreground">{t('savedNote')}</p>
      </section>
      <ExcessStockReport report={report} />
    </div>
  )
}
