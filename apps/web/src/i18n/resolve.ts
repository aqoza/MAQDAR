import { type AppLocale, defaultLocale } from './config'

export type ResolveLocaleInput = {
  /** Raw value of the `locale` cookie, if any. */
  cookie: string | undefined
  /** `arabic_enabled` of the active organization; null when anonymous or without an active organization. */
  arabicEnabled: boolean | null
}

/**
 * The locale a request renders in. Arabic is opt-in per organization: it needs both the user's
 * cookie preference and the active organization's `arabic_enabled` flag. Everything else,
 * including anonymous requests and users without an active organization, renders English.
 */
export function resolveLocale({ cookie, arabicEnabled }: ResolveLocaleInput): AppLocale {
  return cookie === 'ar' && arabicEnabled === true ? 'ar' : defaultLocale
}
