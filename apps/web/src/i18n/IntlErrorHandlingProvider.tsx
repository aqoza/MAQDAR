'use client'

import { NextIntlClientProvider, useLocale } from 'next-intl'
import type { ReactNode } from 'react'
import { getMessageFallback, onIntlError } from './errors'

/**
 * Nested inside the server-rendered provider: it inherits messages, time zone and formats, and
 * adds the error hooks that cannot be serialized from the server. The locale cannot be inferred
 * inside a Client Component, so it is passed through explicitly.
 */
export function IntlErrorHandlingProvider({ children }: { children: ReactNode }) {
  const locale = useLocale()
  return (
    <NextIntlClientProvider
      locale={locale}
      onError={onIntlError}
      getMessageFallback={getMessageFallback}
    >
      {children}
    </NextIntlClientProvider>
  )
}
