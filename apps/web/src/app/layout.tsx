import './globals.css'

import type { Metadata } from 'next'
import { Inter, Noto_Sans_Arabic } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getTranslations } from 'next-intl/server'
import { DirectionProvider } from '@/components/ui/direction'
import { TooltipProvider } from '@/components/ui/tooltip'
import { directionOf, toAppLocale } from '@/i18n/config'
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

  return (
    <html
      lang={locale}
      dir={dir}
      className={cn('font-sans antialiased', inter.variable, notoSansArabic.variable)}
    >
      <body>
        <NextIntlClientProvider>
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
