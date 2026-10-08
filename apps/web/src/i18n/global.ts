import type { IntlLocale } from './config'
import type { Messages } from './messages'
import type { formats } from './request'

declare module 'next-intl' {
  interface AppConfig {
    Locale: IntlLocale
    Messages: Messages
    Formats: typeof formats
  }
}
