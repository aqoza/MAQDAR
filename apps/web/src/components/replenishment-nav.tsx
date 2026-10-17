import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

/** The four saved purchasing workspaces share navigation, not selection or mutation state. */
export async function ReplenishmentNav({
  current,
}: {
  current: 'drafts' | 'review' | 'handoffs' | 'batches'
}) {
  const t = await getTranslations('PurchasingNav')
  const links = [
    ['drafts', '/replenishment'],
    ['review', '/replenishment/review'],
    ['handoffs', '/replenishment/handoffs'],
    ['batches', '/replenishment/batches'],
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
