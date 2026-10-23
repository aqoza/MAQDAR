import type { Formats } from 'next-intl'
import { getRequestConfig } from 'next-intl/server'
import { cookies, headers } from 'next/headers'
import { getSupplierPortals } from '@/lib/supplier-portal-context'
import { portalGrantFromPath } from '@/lib/supplier-portal'
import { getSessionClaims } from '@/lib/auth/session'
import { getActiveContext } from '@/lib/organizations/context'
import { LOCALE_COOKIE, intlLocaleFor, timeZoneOrFallback } from './config'
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
 * organization's Arabic toggle, with the organization's default language for members who have not
 * chosen one. The organization also supplies the numbering system (Arabic only) and the time zone.
 *
 * This runs for every route, /login included, so anonymous requests stay database-free:
 * getSessionClaims() only verifies the session token (memoised per request; without a session
 * cookie it returns at once), and only a signed-in request reads the active organization through
 * getActiveContext(), which is memoised too and already loaded by the app layout. Anonymous requests render English, Latin digits and UTC. Supplier detail routes resolve
 * preferences through a currently accessible grant; route metadata never grants authority.
 */
export default getRequestConfig(async () => {
  const store = await cookies()
  const cookie = store.get(LOCALE_COOKIE)?.value

  const claims = await getSessionClaims()
  const active = claims ? ((await getActiveContext())?.active ?? null) : null

  const grantId = portalGrantFromPath((await headers()).get('x-zeespare-pathname'))
  const portal =
    claims && grantId ? (await getSupplierPortals()).find((g) => g.id === grantId) : null
  const preferences = portal ?? active
  const appLocale = resolveLocale({
    cookie,
    arabicEnabled: preferences?.arabic_enabled ?? null,
    organizationDefault: preferences?.default_locale ?? null,
  })

  return {
    locale: intlLocaleFor(appLocale, preferences?.numbering_system),
    messages: messagesFor(appLocale),
    // Timestamps render in the organization's zone (its own, else its home country's). Date-only
    // columns must be formatted with timeZone 'UTC' explicitly so they never shift a day.
    timeZone: timeZoneOrFallback(active?.effective_time_zone),
    formats,
    onError: onIntlError,
    getMessageFallback,
  }
})
