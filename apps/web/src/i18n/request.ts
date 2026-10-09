import type { Formats } from 'next-intl'
import { getRequestConfig } from 'next-intl/server'
import { cookies } from 'next/headers'
import { LOCALE_COOKIE, defaultLocale, intlLocales, isAppLocale } from './config'
import { getMessageFallback, onIntlError } from './errors'
import { messagesFor } from './messages'

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

// No URL prefix: the locale is a per-user/per-organization setting read from a cookie.
// Step 3 replaces the cookie source with the organization's Arabic toggle.
export default getRequestConfig(async () => {
  const store = await cookies()
  const candidate = store.get(LOCALE_COOKIE)?.value
  const appLocale = isAppLocale(candidate) ? candidate : defaultLocale

  return {
    locale: intlLocales[appLocale],
    messages: messagesFor(appLocale),
    timeZone: 'UTC',
    formats,
    onError: onIntlError,
    getMessageFallback,
  }
})
