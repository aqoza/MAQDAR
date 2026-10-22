import Link from 'next/link'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { RegionalStockForm } from '@/components/regional-stock-form'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'
import { reportingDay } from '@/lib/dashboard'
import { displayName } from '@/lib/format'
import { regionalStockPath } from '@/lib/regional-stock'
export default async function NewRegionalStock({
  searchParams,
}: {
  searchParams: Promise<{ region?: string | string[] }>
}) {
  const search = await searchParams
  const selected = search.region === undefined ? null : z.guid().safeParse(search.region)
  if (selected && !selected.success) notFound()
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  if (!isEditorRole(context.role)) notFound()
  const [db, t, messages, locale] = await Promise.all([
    createClient(),
    getTranslations('RegionalStock'),
    getMessages(),
    getLocale(),
  ])
  const locations = await db
    .from('locations')
    .select('code,name_en,name_ar')
    .eq('organization_id', context.active.id)
    .eq('is_active', true)
    .order('code')
    .limit(200)
  if (locations.error) throw new Error('Location suggestions unavailable')
  const regions = await db
    .from('stock_regions')
    .select('id,name_en,name_ar,location_codes')
    .eq('organization_id', context.active.id)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .order('id')
    .limit(200)
  if (regions.error) throw new Error('Region suggestions unavailable')
  if (selected?.success && !regions.data.some((r) => r.id === selected.data)) {
    const region = await db
      .from('stock_regions')
      .select('id,name_en,name_ar,location_codes')
      .eq('organization_id', context.active.id)
      .eq('id', selected.data)
      .is('archived_at', null)
      .maybeSingle()
    if (region.error) throw new Error('Region selection unavailable')
    if (!region.data) notFound()
    regions.data = [region.data, ...regions.data]
  }
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('new')}
        description={t('description')}
        back={
          <Link href={regionalStockPath} className="underline">
            {t('title')}
          </Link>
        }
        actions={
          <HelpDisclosure label={t('methodDetails')}>
            <p>{t('method')}</p>
            <p>{t('limits')}</p>
          </HelpDisclosure>
        }
      />
      <NextIntlClientProvider
        messages={{ StockRegion: messages.StockRegion, RegionalStock: messages.RegionalStock }}
      >
        <RegionalStockForm
          initialRegionId={selected?.success ? selected.data : ''}
          regions={regions.data.map((r) => ({
            id: r.id,
            name: displayName(r, locale).primary,
            codes: r.location_codes,
          }))}
          organizationId={context.active.id}
          requestId={randomUUID()}
          today={reportingDay(new Date(), context.active.effective_time_zone)}
          locations={locations.data.map((l) => ({
            code: l.code,
            name: displayName(l, locale).primary,
          }))}
        />
      </NextIntlClientProvider>
    </div>
  )
}
