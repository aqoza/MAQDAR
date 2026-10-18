import { useTranslations } from 'next-intl'
import { HelpSidePanel } from './help-side-panel'

/** Resolve workbench copy on the server; the shared drawer handles interaction. */
export function IntegrationResultsHelp() {
  const t = useTranslations('IntegrationWorkbench')
  return (
    <HelpSidePanel title={t('help.title')} description={t('title')} closeLabel={t('help.close')}>
      <p>{t('help.intro')}</p>
      <section className="space-y-2">
        <h2 className="text-section-title text-primary">{t('help.statusTitle')}</h2>
        <p>{t('help.statusBody')}</p>
        <div data-help-callout className="mt-4 space-y-1 border">
          <p className="font-semibold">{t('help.noReportTitle')}</p>
          <p>{t('help.noReportBody')}</p>
        </div>
      </section>
      {(['labels', 'filter', 'histories', 'selection'] as const).map((section) => (
        <section className="space-y-2" key={section}>
          <h2 className="text-section-title text-primary">{t(`help.${section}Title`)}</h2>
          <p>{t(`help.${section}Body`)}</p>
        </section>
      ))}
    </HelpSidePanel>
  )
}
