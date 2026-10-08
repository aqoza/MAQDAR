import { IntlErrorCode, type IntlError } from 'next-intl'

const isDev = process.env.NODE_ENV !== 'production'

/** Shared by the server request config and the client provider (functions do not cross the RSC boundary). */
export function onIntlError(error: IntlError) {
  if (error.code === IntlErrorCode.MISSING_MESSAGE) {
    // Arabic falls back to English through deepMerge, so a missing message means en.json lacks the key.
    if (isDev) console.warn(`[i18n] ${error.message}`)
    return
  }
  if (isDev) console.error(`[i18n] ${error.message}`)
}

export function getMessageFallback({ namespace, key }: { namespace?: string; key: string }) {
  return [namespace, key].filter(Boolean).join('.')
}
