'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { startTransition } from 'react'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { sectionPattern } from '@/lib/section-pattern'

export function SectionNotFound() {
  const t = useTranslations('Common')
  const pattern = sectionPattern(usePathname())
  return (
    <PageHeader
      pattern={pattern}
      title={t('notFoundTitle')}
      description={t('notFoundDescription')}
      actions={
        <bdi dir="ltr" className="self-center text-xs text-muted-foreground">
          404
        </bdi>
      }
      back={
        <Link href="/dashboard" className="underline">
          {t('backToDashboard')}
        </Link>
      }
    />
  )
}

/** Generic recovery only: do not render database errors, identifiers or exception messages. */
export function SectionError({ reset }: { reset: () => void }) {
  const t = useTranslations('Common')
  const pattern = sectionPattern(usePathname())
  const router = useRouter()
  return (
    <div className="min-w-0 space-y-4" role="alert">
      <PageHeader
        pattern={pattern}
        title={t('pageErrorTitle')}
        description={t('pageErrorDescription')}
        back={
          <Link href="/dashboard" className="underline">
            {t('backToDashboard')}
          </Link>
        }
      />
      <Button
        type="button"
        onClick={() =>
          startTransition(() => {
            router.refresh()
            reset()
          })
        }
      >
        {t('retry')}
      </Button>
    </div>
  )
}
