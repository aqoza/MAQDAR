import { useTranslations } from 'next-intl'
import { HelpSidePanel } from './help-side-panel'

/** Resolve page copy on the server; the drawer only handles interaction. */
export function ReplenishmentDraftsHelp() {
  const t = useTranslations('Replenishment')
  return (
    <HelpSidePanel title={t('help.title')} description={t('title')} closeLabel={t('help.close')}>
      <section className="space-y-2">
        <h2 className="text-section-title text-primary">{t('help.policyTitle')}</h2>
        <p>{t('help.policyBody')}</p>
      </section>
      <section className="space-y-2">
        <h2 className="text-section-title text-primary">{t('help.gapTitle')}</h2>
        <p>{t('help.gapBody')}</p>
      </section>
      <p className="rounded-lg border bg-accent/50 p-4 font-semibold text-primary">
        {t('help.note')}
      </p>
      <section className="space-y-2">
        <h2 className="text-section-title text-primary">{t('help.nextTitle')}</h2>
        <p>{t('help.nextBody')}</p>
      </section>
    </HelpSidePanel>
  )
}
