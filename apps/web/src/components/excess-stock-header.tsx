import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { PageHeader } from './page-header'
import { ReplenishmentNav } from './replenishment-nav'
import { HelpSidePanel } from './help-side-panel'

export async function ExcessStockHeader({
  detail = false,
  create = false,
}: {
  detail?: boolean
  create?: boolean
}) {
  const t = await getTranslations('ExcessStock')
  const ht = await getTranslations('ExcessDispositionHandoffs')
  return (
    <PageHeader
      pattern="replenishment"
      title={t(detail ? 'assessment' : 'title')}
      description={t('context')}
      navigation={<ReplenishmentNav current="excess" />}
      help={
        <HelpSidePanel
          title={t('help.title')}
          description={t('title')}
          closeLabel={t('help.close')}
        >
          <section className="space-y-2">
            <h2 className="text-section-title">{t('help.methodTitle')}</h2>
            <p>{t('help.method')}</p>
          </section>
          <section className="space-y-2">
            <h2 className="text-section-title">{t('help.evidenceTitle')}</h2>
            <p>{t('help.evidence')}</p>
          </section>
          <p data-help-callout className="border font-semibold">
            {t('help.limit')}
          </p>
        </HelpSidePanel>
      }
      actions={
        <div className="flex flex-wrap gap-3">
          <Link
            className="rounded-md border bg-background px-3 py-2"
            href="/replenishment/excess/handoffs"
          >
            {ht('title')}
          </Link>
          <Link
            className="rounded-md border bg-background px-3 py-2"
            href="/replenishment/excess/review"
          >
            {t('dispositions')}
          </Link>
          <Link
            className="rounded-md border bg-background px-3 py-2"
            href={create ? '/replenishment/excess/new' : '/replenishment/excess'}
          >
            {t(create ? 'new' : 'history')}
          </Link>
        </div>
      }
    />
  )
}
