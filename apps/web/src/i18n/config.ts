// Locale model: the application locale (`en` | `ar`) is what we store in the cookie (and, from
// Step 3, in organization settings) and put on <html lang>. The Intl tag handed to next-intl pins
// Arabic to Latin digits so quantities and money render identically on every browser; an
// Arabic-Indic digit option becomes a per-organization setting later.

export const appLocales = ['en', 'ar'] as const
export type AppLocale = (typeof appLocales)[number]

export const defaultLocale: AppLocale = 'en'

export const LOCALE_COOKIE = 'locale'

export const intlLocales = {
  en: 'en',
  ar: 'ar-u-nu-latn',
} as const satisfies Record<AppLocale, string>
export type IntlLocale = (typeof intlLocales)[AppLocale]

export type Direction = 'ltr' | 'rtl'
export const directions = {
  en: 'ltr',
  ar: 'rtl',
} as const satisfies Record<AppLocale, Direction>

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (appLocales as readonly string[]).includes(value)
}

/** Maps an Intl tag such as `ar-u-nu-latn` back to the application locale. */
export function toAppLocale(intlLocale: string): AppLocale {
  const language = new Intl.Locale(intlLocale).language
  return isAppLocale(language) ? language : defaultLocale
}

export function directionOf(locale: AppLocale): Direction {
  return directions[locale]
}
