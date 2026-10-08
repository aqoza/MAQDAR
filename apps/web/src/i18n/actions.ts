'use server'

import { cookies } from 'next/headers'
import { LOCALE_COOKIE, isAppLocale } from './config'

const ONE_YEAR = 60 * 60 * 24 * 365

/** Sets the locale cookie. Next.js re-renders the current page and its layouts afterwards. */
export async function setLocale(locale: string): Promise<void> {
  if (!isAppLocale(locale)) throw new Error(`Unsupported locale: ${locale}`)
  const store = await cookies()
  store.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: ONE_YEAR,
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  })
}
