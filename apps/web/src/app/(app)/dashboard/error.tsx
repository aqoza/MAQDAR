'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { startTransition } from 'react'

export default function DashboardError({ reset }: { reset: () => void }) {
  const t = useTranslations('DashboardState')
  const router = useRouter()
  return (
    <div data-dashboard className="dashboard-workspace">
      <div className="dashboard-hero">
        <h1>{t('title')}</h1>
      </div>
      <section className="dashboard-panel" role="alert">
        <p>{t('message')}</p>
        <button
          className="dashboard-retry"
          type="button"
          onClick={() =>
            startTransition(() => {
              router.refresh()
              reset()
            })
          }
        >
          {t('retry')}
        </button>
      </section>
    </div>
  )
}
