import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { ReplenishmentNav } from '@/components/replenishment-nav'

export async function StockLocatorHeader() {
  const t = await getTranslations('StockLocator')
  return (
    <PageHeader
      pattern="replenishment"
      title={t('title')}
      description={t('description')}
      navigation={<ReplenishmentNav current="locator" />}
      help={
        <HelpDisclosure>
          <p>{t('stockHelp')}</p>
          <p>{t('distanceHelp')}</p>
          <p>{t('historyHelp')}</p>
        </HelpDisclosure>
      }
    />
  )
}
