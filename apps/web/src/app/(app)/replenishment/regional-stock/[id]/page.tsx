import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getFormatter, getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { RegionalStockReport } from '@/components/regional-stock-report'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { regionalStockReportSchema } from '@/lib/regional-stock'

export default async function RegionalStockDetail({ params }: { params: Promise<{ id: string }> }) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { id } = await params
  if (!z.guid().safeParse(id).success) notFound()
  const [db, t, messages, format] = await Promise.all([
    createClient(),
    getTranslations('RegionalStock'),
    getMessages(),
    getFormatter(),
  ])
  const { data, error } = await db
    .from('regional_stock_assessments')
    .select('assessment_name,created_at,report')
    .eq('organization_id', context.active.id)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error('Regional stock assessment unavailable')
  if (!data) notFound()
  const report = regionalStockReportSchema.parse(data.report)
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="replenishment"
        title={data.assessment_name}
        description={t('savedAt', { time: format.dateTime(new Date(data.created_at), 'long') })}
        back={
          <Link href="/replenishment/regional-stock" className="underline">
            {t('title')}
          </Link>
        }
        actions={
          <>
            <HelpDisclosure label={t('methodDetails')}>
              <p>{t('method')}</p>
              <p>{t('limits')}</p>
            </HelpDisclosure>
          </>
        }
      />
      <NextIntlClientProvider
        messages={{
          StockRegion: messages.StockRegion,
          RegionalStock: messages.RegionalStock,
        }}
      >
        <RegionalStockReport report={report} />
      </NextIntlClientProvider>
    </div>
  )
}
