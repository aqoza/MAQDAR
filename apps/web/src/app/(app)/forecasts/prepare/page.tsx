import { PageHeader } from '@/components/page-header'
import Link from 'next/link'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { notFound, redirect } from 'next/navigation'
import { PreparationForm } from '@/components/preparation-form'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { reportingDay } from '@/lib/dashboard'

export default async function PreparePage() {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  if (!isEditorRole(context.role)) notFound()
  const [t, messages] = await Promise.all([getTranslations('Preparation'), getMessages()])
  const today = reportingDay(new Date(), context.active.effective_time_zone)
  const to = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10)
  const from = new Date(Date.parse(to) - 364 * 86400000).toISOString().slice(0, 10)
  return (
    <div className="space-y-4">
      <Link href="/forecasts" className="text-sm underline">
        {t('back')}
      </Link>
      <PageHeader title={t('title')} description={t('description')} />
      <NextIntlClientProvider messages={{ Preparation: messages.Preparation }}>
        <PreparationForm
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
