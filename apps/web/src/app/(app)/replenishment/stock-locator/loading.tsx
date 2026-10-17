import { getTranslations } from 'next-intl/server'
import { StockLocatorHeader } from '@/components/stock-locator-header'

export default async function Loading() {
  const t = await getTranslations('StockLocator')
  return (
    <div className="min-w-0 space-y-4">
      <StockLocatorHeader />
      <p role="status">{t('loading')}</p>
    </div>
  )
}
