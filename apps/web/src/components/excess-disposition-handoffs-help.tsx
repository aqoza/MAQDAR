import { getTranslations } from 'next-intl/server'
import { HelpSidePanel } from './help-side-panel'
export async function ExcessDispositionHandoffsHelp() {
  const t = await getTranslations('ExcessDispositionHandoffs')
  return (
    <HelpSidePanel title={t('help.title')} description={t('title')} closeLabel={t('help.close')}>
      <section className="space-y-2">
        <h2 className="text-section-title">{t('help.methodTitle')}</h2>
        <p>{t('help.method')}</p>
      </section>
      <section className="space-y-2">
        <h2 className="text-section-title">{t('help.historyTitle')}</h2>
        <p>{t('help.history')}</p>
      </section>
      <p data-help-callout className="border font-semibold">
        {t('help.limit')}
      </p>
    </HelpSidePanel>
  )
}
