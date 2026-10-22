import Link from 'next/link'
import { randomUUID } from 'node:crypto'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { StockRegionForm } from '@/components/stock-region-form'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'
import { displayName } from '@/lib/format'
import { stockRegionsPath } from '@/lib/stock-regions'
export default async function NewStockRegion() {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  if (!isEditorRole(context.role)) notFound()
  const [db, t, messages, locale] = await Promise.all([
    createClient(),
    getTranslations('StockRegion'),
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
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('new')}
        description={t('description')}
        back={
          <Link href={stockRegionsPath} className="underline">
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
        <StockRegionForm
          organizationId={context.active.id}
          requestId={randomUUID()}
          locations={locations.data.map((l) => ({
            code: l.code,
            name: displayName(l, locale).primary,
          }))}
        />
      </NextIntlClientProvider>
    </div>
  )
}
