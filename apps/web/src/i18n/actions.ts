'use server'

import { cookies } from 'next/headers'
import { getActiveContext } from '@/lib/organizations/context'
import { LOCALE_COOKIE, isAppLocale } from './config'
import { resolveLocale } from './resolve'

const ONE_YEAR = 60 * 60 * 24 * 365

/**
 * Sets the locale cookie. Next.js re-renders the current page and its layouts afterwards.
 * Arabic is refused (nothing is written) unless the active organization has it enabled; the
 * request config applies the same gate when it reads the cookie, so a stale cookie is harmless.
 */
export async function setLocale(locale: string): Promise<void> {
  if (!isAppLocale(locale)) throw new Error(`Unsupported locale: ${locale}`)

  if (locale === 'ar') {
    const context = await getActiveContext()
    const allowed = resolveLocale({
      cookie: locale,
      arabicEnabled: context?.active?.arabic_enabled ?? false,
    })
    if (allowed !== locale) return
  }

  const store = await cookies()
  store.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: ONE_YEAR,
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  })
}
