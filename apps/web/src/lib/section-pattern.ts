import type { PageHeaderPattern } from '@/components/page-header-art'

/** Recovery screens retain the URL's section without exposing unavailable record details. */
export function sectionPattern(pathname: string): PageHeaderPattern {
  const section = pathname.split('/')[1]
  switch (section) {
    case 'items':
    case 'locations':
    case 'suppliers':
    case 'imports':
    case 'forecasts':
    case 'replenishment':
    case 'settings':
      return section
    default:
      return 'settings'
  }
}
