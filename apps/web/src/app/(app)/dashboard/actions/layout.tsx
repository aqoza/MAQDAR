import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { pickNamespaces } from '@/i18n/config'

export default async function Layout({ children }: { children: React.ReactNode }) {
  const messages = await getMessages()
  return (
    <NextIntlClientProvider
      messages={pickNamespaces(messages, ['PlannerActions', 'StockComparison', 'Forecasting'])}
    >
      {children}
    </NextIntlClientProvider>
  )
}
