import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { StockLocatorHelp } from '@/components/replenishment-workspace-help'
import { ReplenishmentNav } from '@/components/replenishment-nav'

export async function StockLocatorHeader() {
  const t = await getTranslations('StockLocator')
  return (
    <PageHeader
      pattern="replenishment"
      title={t('title')}
      description={t('description')}
      navigation={<ReplenishmentNav current="locator" />}
      help={<StockLocatorHelp />}
    />
  )
}
