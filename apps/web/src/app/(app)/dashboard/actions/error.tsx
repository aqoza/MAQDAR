'use client'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { startTransition } from 'react'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'

export default function Error({ reset }: { reset: () => void }) {
  const t = useTranslations('PlannerActions')
  const router = useRouter()
  return (
    <div className="space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('title')}
        back={<Link href="/dashboard">{t('overview')}</Link>}
      />
      <section className="workspace-panel space-y-3" role="alert">
        <h2 className="text-section-title">{t('unavailableTitle')}</h2>
        <p>{t('unavailableBody')}</p>
        <Button
          onClick={() =>
            startTransition(() => {
              router.refresh()
              reset()
            })
          }
        >
          {t('refresh')}
        </Button>
      </section>
    </div>
  )
}
