'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { setLocale } from '@/i18n/actions'
import { appLocales, toAppLocale } from '@/i18n/config'

export function LocaleSwitcher() {
  const t = useTranslations('Settings.language')
  const current = toAppLocale(useLocale())
  const [pending, startTransition] = useTransition()

  return (
    <div role="radiogroup" aria-label={t('title')} className="flex flex-wrap gap-2">
      {appLocales.map((locale) => {
        const selected = locale === current
        return (
          <Button
            key={locale}
            type="button"
            role="radio"
            aria-checked={selected}
            variant={selected ? 'default' : 'outline'}
            disabled={pending}
            onClick={() => startTransition(() => setLocale(locale))}
          >
            {t(locale)}
          </Button>
        )
      })}
    </div>
  )
}
