import { useTranslations } from 'next-intl'
import { HelpSidePanel } from './help-side-panel'
export function EventPurchaseHandoffsHelp() {
  const t = useTranslations('EventPurchaseHandoffs')
  const common = useTranslations('Common')
  return (
    <HelpSidePanel
      title={common('methodDetails')}
      description={t('title')}
      closeLabel={common('close')}
    >
      <p>{t('description')}</p>
      <section>
        <h2>{t('selection')}</h2>
        <p>{t('selectionHelp')}</p>
      </section>
      <section>
        <h2>{t('currentContext')}</h2>
        <p>{t('immutableNote')}</p>
      </section>
      <section>
        <h2>{t('csv')}</h2>
        <p>{t('csvNote')}</p>
      </section>
    </HelpSidePanel>
  )
}
