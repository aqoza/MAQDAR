import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getFormatter, getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { RegionalSourcingReport } from '@/components/regional-sourcing-report'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { regionalSourcingPath, regionalSourcingReportSchema } from '@/lib/regional-sourcing'
export default async function RegionalSourcingDetail({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!z.guid().safeParse(id).success) notFound()
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const [db, t, messages, format] = await Promise.all([
    createClient(),
    getTranslations('RegionalSourcing'),
    getMessages(),
    getFormatter(),
  ])
  const { data, error } = await db
    .from('regional_sourcing_scenarios')
    .select('report,created_at')
    .eq('organization_id', context.active.id)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error('Sourcing history unavailable')
  if (!data) notFound()
  const report = regionalSourcingReportSchema.parse(data.report)
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('detail')}
        description={t('description')}
        back={
          <Link className="underline" href={regionalSourcingPath}>
            {t('title')}
          </Link>
        }
      />
      <p className="text-xs text-muted-foreground">
        {t('savedAt')}: {format.dateTime(new Date(data.created_at), 'long')}
      </p>
      <NextIntlClientProvider
        messages={{
          RegionalSourcing: messages.RegionalSourcing,
          Redistribution: messages.Redistribution,
          StockComparison: messages.StockComparison,
          StockRegion: messages.StockRegion,
        }}
      >
        <RegionalSourcingReport report={report} />
      </NextIntlClientProvider>
    </div>
  )
}
