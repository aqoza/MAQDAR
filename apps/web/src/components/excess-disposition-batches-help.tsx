import { getTranslations } from 'next-intl/server'
import { HelpSidePanel } from '@/components/help-side-panel'

export async function ExcessDispositionBatchesHelp() {
  const t = await getTranslations('ExcessDispositionBatches')
  const common = await getTranslations('Common')
  return (
    <HelpSidePanel
      title={common('methodDetails')}
      description={t('title')}
      closeLabel={common('close')}
    >
      <section>
        <h3>{t('groupingTitle')}</h3>
        <p>{t('grouping')}</p>
        <p>{t('saveNote')}</p>
      </section>
      <section>
        <h3>{t('totalsTitle')}</h3>
        <p>{t('totalNote')}</p>
        <p>{t('csvNote')}</p>
      </section>
      <section>
        <h3>{t('historyTitle')}</h3>
        <p>{t('immutableNote')}</p>
        <p>{t('overlapNote')}</p>
      </section>
      <p className="help-callout">{t('description')}</p>
    </HelpSidePanel>
  )
}
