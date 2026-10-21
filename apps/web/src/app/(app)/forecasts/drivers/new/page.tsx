import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { ExternalDriverForm } from '@/components/external-driver-form'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { reportingDay } from '@/lib/dashboard'

export default async function NewDriverDataset() {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  if (!isEditorRole(context.role)) notFound()
  const [t, messages] = await Promise.all([getTranslations('ExternalDrivers'), getMessages()])
  const today = Date.parse(reportingDay(new Date(), context.active.effective_time_zone))
  const day = (offset: number) => new Date(today + offset * 86400000).toISOString().slice(0, 10)
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="forecasts"
        title={t('new')}
        description={t('description')}
        back={
          <Link href="/forecasts/drivers" className="underline">
            {t('title')}
          </Link>
        }
        actions={
          <HelpDisclosure label={t('methodDetails')}>
            <p>{t('method')}</p>
            <p>{t('limits')}</p>
          </HelpDisclosure>
        }
      />
      <NextIntlClientProvider
        messages={{
          ExternalDrivers: messages.ExternalDrivers,
          LocationLookup: messages.LocationLookup,
        }}
      >
        <ExternalDriverForm
          organizationId={context.active.id}
          requestId={crypto.randomUUID()}
          defaults={{ history_from: day(-365), cutoff: day(-1), forecast_to: day(27) }}
        />
      </NextIntlClientProvider>
    </div>
  )
}
