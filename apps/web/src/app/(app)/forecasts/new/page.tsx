import Link from 'next/link'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { notFound, redirect } from 'next/navigation'
import { ForecastForm } from '@/components/forecast-form'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { reportingDay } from '@/lib/dashboard'

export default async function NewForecastPage() {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  if (!isEditorRole(context.role)) notFound()
  const [t, messages] = await Promise.all([getTranslations('Forecasting'), getMessages()])
  const today = reportingDay(new Date(), context.active.effective_time_zone)
  const to = new Date(Date.parse(today) - 86_400_000).toISOString().slice(0, 10)
  const from = new Date(Date.parse(to) - 364 * 86_400_000).toISOString().slice(0, 10)
  return (
    <div className="space-y-5">
      <Link href="/forecasts" className="text-sm underline">
        {t('back')}
      </Link>
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p className="text-muted-foreground">{t('description')}</p>
      <NextIntlClientProvider messages={{ Forecasting: messages.Forecasting }}>
        <ForecastForm
          key={context.active.id}
          organizationId={context.active.id}
          requestId={crypto.randomUUID()}
          from={from}
          to={to}
        />
      </NextIntlClientProvider>
    </div>
  )
}
