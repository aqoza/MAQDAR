// Locale model: the application locale (`en` | `ar`) is what we store in the cookie and in the
// organization's default_locale, and what goes on <html lang>. The Intl tag handed to next-intl
// adds the organization's numbering system for Arabic: Latin digits by default (quantities and
// money render identically on every browser), Arabic-Indic digits when the organization asks for
// them. English always uses Latin digits.

import type { Messages } from './messages'

export const appLocales = ['en', 'ar'] as const
export type AppLocale = (typeof appLocales)[number]

export const defaultLocale: AppLocale = 'en'

export const LOCALE_COOKIE = 'locale'

/** organizations.numbering_system: `latn` (123) or `arab` (١٢٣). Only the Arabic UI uses it. */
export const numberingSystems = ['latn', 'arab'] as const
export type NumberingSystem = (typeof numberingSystems)[number]

export const defaultNumberingSystem: NumberingSystem = 'latn'

/** Every Intl tag the app hands to next-intl, per application locale and numbering system. */
export const intlLocaleTags = {
  en: { latn: 'en', arab: 'en' },
  ar: { latn: 'ar-u-nu-latn', arab: 'ar-u-nu-arab' },
} as const satisfies Record<AppLocale, Record<NumberingSystem, string>>
export type IntlLocale = (typeof intlLocaleTags)[AppLocale][NumberingSystem]

/** Intl tags with the default (Latin) numbering system. */
export const intlLocales = {
  en: intlLocaleTags.en.latn,
  ar: intlLocaleTags.ar.latn,
} as const satisfies Record<AppLocale, IntlLocale>

export type Direction = 'ltr' | 'rtl'
export const directions = {
  en: 'ltr',
  ar: 'rtl',
} as const satisfies Record<AppLocale, Direction>

/** The zone used when nothing better is known (anonymous requests, unknown zone names). */
export const fallbackTimeZone = 'UTC'

/**
 * Message namespaces serialized into the root NextIntlClientProvider. Everything else (the
 * per-entity master-data namespaces, page copy) stays on the server, which keeps the message JSON
 * inlined into every page small. A Client Component may only call useTranslations() with one of
 * these namespaces; Server Components can use any.
 */
export const clientNamespaces = [
  'Common',
  'Auth',
  'Nav',
  'Organizations',
  'Invitations',
  'Members',
  'InviteMembers',
  'Onboarding',
  'ApiKeys',
  'Roles',
  'Settings',
  'Validation',
  'RpcErrors',
  'MasterDataClient',
  'DashboardState',
  'LocationLookup',
] as const satisfies ReadonlyArray<keyof Messages>

/**
 * Namespaces only the import pages' Client Components use (about 15 KB): serialized by the
 * provider of `/imports/*` (src/app/(app)/imports/layout.tsx) on top of clientNamespaces, so other
 * pages, /login included, never carry the wizard's vocabulary.
 */
export const importClientNamespaces = [
  'ImportsClient',
  'ImportErrors',
] as const satisfies ReadonlyArray<keyof Messages>

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (appLocales as readonly string[]).includes(value)
}

export function isNumberingSystem(value: unknown): value is NumberingSystem {
  return typeof value === 'string' && (numberingSystems as readonly string[]).includes(value)
}

/**
 * The Intl tag for an application locale and the organization's numbering system: `en`,
 * `ar-u-nu-latn` or `ar-u-nu-arab`. Unknown or missing numbering systems mean Latin digits.
 */
export function intlLocaleFor(locale: AppLocale, numbering?: string | null): IntlLocale {
  return intlLocaleTags[locale][isNumberingSystem(numbering) ? numbering : defaultNumberingSystem]
}

/** Maps an Intl tag such as `ar-u-nu-latn` back to the application locale. */
export function toAppLocale(intlLocale: string): AppLocale {
  const language = new Intl.Locale(intlLocale).language
  return isAppLocale(language) ? language : defaultLocale
}

export function directionOf(locale: AppLocale): Direction {
  return directions[locale]
}

/**
 * `zone` when the runtime knows it as an IANA time zone, else UTC. The database only stores zones
 * from public.countries (or UTC), so this only guards against a runtime without that zone: an
 * unknown zone would otherwise make every date format on the page throw.
 */
export function timeZoneOrFallback(zone: string | null | undefined): string {
  if (!zone) return fallbackTimeZone
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return zone
  } catch {
    return fallbackTimeZone
  }
}

/** Keeps only the listed top-level namespaces of a message object (missing ones are skipped). */
export function pickNamespaces<T extends Record<string, unknown>>(
  messages: T,
  namespaces: readonly string[],
): Partial<T> {
  const picked: Partial<T> = {}
  for (const namespace of namespaces) {
    if (Object.hasOwn(messages, namespace)) {
      picked[namespace as keyof T] = messages[namespace as keyof T]
    }
  }
  return picked
}
