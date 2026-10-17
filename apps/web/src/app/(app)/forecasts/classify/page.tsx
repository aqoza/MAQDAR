import { HelpDisclosure } from '@/components/help-disclosure'
import { PageHeader } from '@/components/page-header'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ClassificationForm } from '@/components/classification-form'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { reportingDay } from '@/lib/dashboard'

export default async function ClassifyPage() {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  if (!isEditorRole(context.role)) notFound()
  const [t, messages] = await Promise.all([getTranslations('Classification'), getMessages()])
  const to = reportingDay(new Date(), context.active.effective_time_zone)
  const from = new Date(Date.parse(to) - 364 * 86_400_000).toISOString().slice(0, 10)
  return (
    <div className="space-y-4">
      <Link href="/forecasts" className="text-sm underline">
        {t('back')}
      </Link>
      <PageHeader title={t('title')} description={t('description')} />
      <HelpDisclosure>
        <p>{t('scope')}</p>
      </HelpDisclosure>
      <NextIntlClientProvider messages={{ Classification: messages.Classification }}>
        <ClassificationForm
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
