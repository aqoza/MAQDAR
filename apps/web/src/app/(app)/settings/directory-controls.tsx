'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export type DirectoryPage = { page: number; total: number; search: string }

export function DirectoryControls({
  section,
  directory,
}: {
  section: 'members' | 'invitations'
  directory: DirectoryPage
}) {
  const t = useTranslations('Onboarding.directory')
  const params = useSearchParams()
  const pages = Math.max(1, Math.ceil(directory.total / 100))
  function href(page: number) {
    const next = new URLSearchParams(params.toString())
    next.set('section', section)
    next.set(`${section}_page`, String(page))
    return `/settings?${next}`
  }
  return (
    <div className="mb-4 flex flex-col gap-3">
      <form action="/settings" className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="section" value={section} />
        <Input
          key={directory.search}
          type="search"
          name={`${section}_search`}
          aria-label={t('searchLabel')}
          placeholder={t('searchLabel')}
          maxLength={254}
          defaultValue={directory.search}
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="outline">
          {t('search')}
        </Button>
      </form>
      <nav
        aria-label={t('pagination')}
        className="flex flex-wrap items-center justify-between gap-2 text-sm"
      >
        <p role="status">{t('summary', { total: directory.total, page: directory.page, pages })}</p>
        <div className="flex gap-3">
          {directory.page > 1 ? (
            <Link
              href={href(directory.page - 1)}
              className="rounded px-2 py-2 underline underline-offset-4"
            >
              {t('previous')}
            </Link>
          ) : null}
          {directory.page < pages ? (
            <Link
              href={href(directory.page + 1)}
              className="rounded px-2 py-2 underline underline-offset-4"
            >
              {t('next')}
            </Link>
          ) : null}
        </div>
      </nav>
    </div>
  )
}
