import Link from 'next/link'
import { LayoutDashboard, ListChecks } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

export async function DashboardNav({ current }: { current: 'overview' | 'actions' }) {
  const t = await getTranslations('PlannerActions')
  return (
    <nav className="workspace-navigation" aria-label={t('navigation')}>
      <Link
        prefetch={false}
        href="/dashboard"
        aria-current={current === 'overview' ? 'page' : undefined}
      >
        <LayoutDashboard className="size-4" aria-hidden="true" />
        {t('overview')}
      </Link>
      <Link
        prefetch={false}
        href="/dashboard/actions"
        aria-current={current === 'actions' ? 'page' : undefined}
      >
        <ListChecks className="size-4" aria-hidden="true" />
        {t('navTitle')}
      </Link>
    </nav>
  )
}
