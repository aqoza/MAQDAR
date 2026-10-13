import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { clientNamespaces, importClientNamespaces, pickNamespaces } from '@/i18n/config'
import { IntlErrorHandlingProvider } from '@/i18n/IntlErrorHandlingProvider'

/**
 * The import pages add the wizard's message namespaces to the ones every page has. A nested
 * provider replaces its parent's messages instead of merging them, so it lists both; the error
 * hooks are added again inside it, as in the root layout.
 */
export default async function ImportsLayout({ children }: { children: React.ReactNode }) {
  const messages = pickNamespaces(await getMessages(), [
    ...clientNamespaces,
    ...importClientNamespaces,
  ])
  return (
    <NextIntlClientProvider messages={messages}>
      <IntlErrorHandlingProvider>{children}</IntlErrorHandlingProvider>
    </NextIntlClientProvider>
  )
}
