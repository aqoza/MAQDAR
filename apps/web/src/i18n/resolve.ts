import { type AppLocale, defaultLocale, isAppLocale } from './config'

export type ResolveLocaleInput = {
  /** Raw value of the `locale` cookie, if any. */
  cookie: string | undefined
  /** `arabic_enabled` of the active organization; null when anonymous or without an active organization. */
  arabicEnabled: boolean | null
  /** `default_locale` of the active organization; null or absent when there is none. */
  organizationDefault?: string | null
}

/**
 * The locale a request renders in. Arabic is opt-in per organization, so it always needs the
 * active organization's `arabic_enabled` flag. Within that:
 *
 * 1. The user's cookie wins: `ar` (when enabled) or `en`.
 * 2. Without a usable cookie (none, or a value that is not a locale), the organization's default
 *    language applies.
 * 3. Everything else, including anonymous requests and users without an active organization,
 *    renders English.
 */
export function resolveLocale({
  cookie,
  arabicEnabled,
  organizationDefault,
}: ResolveLocaleInput): AppLocale {
  const preferred = isAppLocale(cookie) ? cookie : organizationDefault
  return preferred === 'ar' && arabicEnabled === true ? 'ar' : defaultLocale
}
