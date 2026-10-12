import './globals.css'

import type { Metadata } from 'next'
import { Inter, Noto_Sans_Arabic } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, getTranslations } from 'next-intl/server'
import { DirectionProvider } from '@/components/ui/direction'
import { TooltipProvider } from '@/components/ui/tooltip'
import { clientNamespaces, directionOf, pickNamespaces, toAppLocale } from '@/i18n/config'
import { IntlErrorHandlingProvider } from '@/i18n/IntlErrorHandlingProvider'
import { cn } from '@/lib/utils'

// Latin and Arabic families are both loaded; globals.css orders the stack per text direction.
const inter = Inter({ subsets: ['latin', 'latin-ext'], variable: '--font-inter', display: 'swap' })
const notoSansArabic = Noto_Sans_Arabic({
  subsets: ['arabic'],
  variable: '--font-arabic',
  display: 'swap',
})

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Common')
  return {
    title: { default: t('appName'), template: `%s · ${t('appName')}` },
    description: t('tagline'),
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = toAppLocale(await getLocale())
  const dir = directionOf(locale)
  // Only the namespaces Client Components use are serialized into the page; Server Components
  // still read every namespace from the request config.
  const messages = pickNamespaces(await getMessages(), clientNamespaces)

  return (
    <html
      lang={locale}
      dir={dir}
      className={cn('font-sans antialiased', inter.variable, notoSansArabic.variable)}
    >
      <body>
        <NextIntlClientProvider messages={messages}>
          <IntlErrorHandlingProvider>
            <DirectionProvider direction={dir}>
              <TooltipProvider>{children}</TooltipProvider>
            </DirectionProvider>
          </IntlErrorHandlingProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
