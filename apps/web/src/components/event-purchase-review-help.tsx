import { useTranslations } from 'next-intl'
import { HelpSidePanel } from './help-side-panel'
export function EventPurchaseReviewHelp() {
  const t = useTranslations('EventPurchaseReview')
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
        <h2>{t('checksTitle')}</h2>
        <p>{t('checksHelp')}</p>
      </section>
    </HelpSidePanel>
  )
}
