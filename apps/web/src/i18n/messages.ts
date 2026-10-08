import ar from '../../messages/ar.json'
import en from '../../messages/en.json'
import type { AppLocale } from './config'

export type Messages = typeof en

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

/** Returns `base` with every value present in `override` replaced, recursing into objects. */
export function deepMerge<T extends object>(base: T, override: DeepPartial<T>): T {
  const result = { ...base } as Record<string, unknown>
  for (const [key, value] of Object.entries(override)) {
    const current = (base as Record<string, unknown>)[key]
    if (isPlainObject(value) && isPlainObject(current)) {
      result[key] = deepMerge(current, value as DeepPartial<object>)
    } else if (value !== undefined) {
      result[key] = value
    }
  }
  return result as T
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** English is complete; Arabic is layered on top so untranslated keys render English. */
export function messagesFor(locale: AppLocale): Messages {
  return locale === 'en' ? en : deepMerge(en, ar)
}

export { ar, en }
