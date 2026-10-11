import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import type { Messages } from '@/i18n/messages'
import type { AreaKey } from '@/lib/master-data/types'
import { cn } from '@/lib/utils'

export type AreaTabKey = Exclude<keyof Messages['MasterData']['tabs'], 'label'>

/** Sub-navigation of the three master-data areas (the sidebar links to the first tab of each). */
export const AREA_TABS: Record<AreaKey, ReadonlyArray<{ key: AreaTabKey; href: string }>> = {
  items: [
    { key: 'items', href: '/items' },
    { key: 'brands', href: '/items/brands' },
    { key: 'supersessions', href: '/items/supersessions' },
    { key: 'interchanges', href: '/items/interchanges' },
  ],
  locations: [
    { key: 'locations', href: '/locations' },
    { key: 'network', href: '/locations/network' },
    { key: 'calendars', href: '/locations/calendars' },
    { key: 'holidays', href: '/locations/holidays' },
  ],
  suppliers: [
    { key: 'suppliers', href: '/suppliers' },
    { key: 'supplierItems', href: '/suppliers/supplier-items' },
    { key: 'fxRates', href: '/suppliers/fx-rates' },
  ],
}

export async function AreaTabs({ area, current }: { area: AreaKey; current: string }) {
  const t = await getTranslations('MasterData.tabs')
  return (
    <nav aria-label={t('label')} className="border-b">
      <ul className="-mb-px flex gap-5 overflow-x-auto">
        {AREA_TABS[area].map((tab) => {
          const active = tab.key === current
          return (
            <li key={tab.key}>
              <Link
                href={tab.href}
                prefetch={false}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex border-b-2 px-0.5 pb-2 text-sm font-medium whitespace-nowrap transition-colors',
                  active
                    ? 'border-primary text-foreground'
                    : 'text-muted-foreground hover:text-foreground border-transparent',
                )}
              >
                {t(tab.key)}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
