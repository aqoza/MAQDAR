import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getFormatter, getLocale, getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { StockRegionReport } from '@/components/stock-region-report'
import { StockRegionArchive } from '@/components/stock-region-archive'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'
import { stockRegionReportSchema, stockRegionsPath } from '@/lib/stock-regions'
import { displayName } from '@/lib/format'

export default async function StockRegionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!z.guid().safeParse(id).success) notFound()
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const [db, t, messages, locale, format] = await Promise.all([
    createClient(),
    getTranslations('StockRegion'),
    getMessages(),
    getLocale(),
    getFormatter(),
  ])
  const { data, error } = await db
    .from('stock_regions')
    .select('id,name_en,name_ar,created_at,archived_at,report')
    .eq('organization_id', context.active.id)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error('Region history unavailable')
  if (!data) notFound()
  const report = stockRegionReportSchema.parse(data.report)
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="replenishment"
        title={displayName(data, locale).primary}
        description={t(data.archived_at ? 'archived' : 'active')}
        back={
          <Link href={stockRegionsPath} className="underline">
            {t('title')}
          </Link>
        }
        actions={
          isEditorRole(context.role) && !data.archived_at ? (
            <>
              <Link
                href={`/replenishment/regional-stock/sourcing/new?region=${data.id}`}
                className="underline"
              >
                {t('sourcing')}
              </Link>
              <Link
                href={`/replenishment/regional-stock/new?region=${data.id}`}
                className="underline"
              >
                {t('use')}
              </Link>
            </>
          ) : undefined
        }
      />
      <p className="break-words text-xs text-muted-foreground">
        {t('importTime')}: {format.dateTime(new Date(data.created_at), 'long')}
        {data.archived_at && (
          <>
            {' '}
            · {t('archivedAt')}: {format.dateTime(new Date(data.archived_at), 'long')}
          </>
        )}
      </p>
      <NextIntlClientProvider messages={{ StockRegion: messages.StockRegion }}>
        <StockRegionReport report={report} />
        {isEditorRole(context.role) && !data.archived_at && (
          <StockRegionArchive organizationId={context.active.id} regionId={data.id} />
        )}
      </NextIntlClientProvider>
    </div>
  )
}
