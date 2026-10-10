import type { Formats } from 'next-intl'
import { getRequestConfig } from 'next-intl/server'
import { cookies } from 'next/headers'
import { getActiveContext } from '@/lib/organizations/context'
import { LOCALE_COOKIE, defaultLocale, intlLocales } from './config'
import { getMessageFallback, onIntlError } from './errors'
import { messagesFor } from './messages'
import { resolveLocale } from './resolve'

export const formats = {
  number: {
    quantity: { maximumFractionDigits: 3 },
    money: { minimumFractionDigits: 2, maximumFractionDigits: 3 },
    percent: { style: 'percent', maximumFractionDigits: 1 },
  },
  dateTime: {
    short: { year: 'numeric', month: 'short', day: 'numeric' },
    long: { dateStyle: 'long', timeStyle: 'short' },
  },
} satisfies Formats

/**
 * No URL prefix: the locale is a per-user preference (the `locale` cookie) gated by the active
 * organization's Arabic toggle. This runs for every route, /login included, so the English path
 * never touches the database: only a cookie asking for Arabic costs the (request-memoised)
 * organization lookup.
 */
export default getRequestConfig(async () => {
  const store = await cookies()
  const cookie = store.get(LOCALE_COOKIE)?.value

  let appLocale = defaultLocale
  if (cookie === 'ar') {
    const context = await getActiveContext()
    appLocale = resolveLocale({ cookie, arabicEnabled: context?.active?.arabic_enabled ?? false })
  }

  return {
    locale: intlLocales[appLocale],
    messages: messagesFor(appLocale),
    timeZone: 'UTC',
    formats,
    onError: onIntlError,
    getMessageFallback,
  }
})
