import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

/** Purchasing workspaces share navigation, not selection or mutation state. */
export async function ReplenishmentNav({
  current,
}: {
  current:
    | 'network'
    | 'excess'
    | 'eventIntegrations'
    | 'eventBatches'
    | 'eventHandoffs'
    | 'eventReview'
    | 'drafts'
    | 'review'
    | 'handoffs'
    | 'batches'
    | 'integrations'
    | 'redistribution'
    | 'locator'
    | 'regionalStock'
}) {
  const t = await getTranslations('PurchasingNav')
  const links = [
    ['drafts', '/replenishment'],
    ['redistribution', '/replenishment/redistribution'],
    ['network', '/replenishment/network'],
    ['locator', '/replenishment/stock-locator'],
    ['regionalStock', '/replenishment/regional-stock'],
    ['excess', '/replenishment/excess'],
    ['review', '/replenishment/review'],
    ['eventReview', '/replenishment/events/review'],
    ['eventHandoffs', '/replenishment/events/handoffs'],
    ['eventBatches', '/replenishment/events/batches'],
    ['eventIntegrations', '/replenishment/events/integrations'],
    ['handoffs', '/replenishment/handoffs'],
    ['batches', '/replenishment/batches'],
    ['integrations', '/replenishment/integrations'],
  ] as const
  return (
    <nav className="workspace-navigation" aria-label={t('label')}>
      {links.map(([key, href]) => (
        <Link
          key={key}
          href={href}
          prefetch={false}
          aria-current={key === current ? 'page' : undefined}
        >
          {t(key)}
        </Link>
      ))}
    </nav>
  )
}
