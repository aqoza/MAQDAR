import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getFormatter, getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { ExternalDriverReport } from '@/components/external-driver-report'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'
import { driverReportSchema } from '@/lib/external-drivers'

export default async function DriverDataset({ params }: { params: Promise<{ id: string }> }) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { id } = await params
  if (!z.guid().safeParse(id).success) notFound()
  const [db, t, messages, format] = await Promise.all([
    createClient(),
    getTranslations('ExternalDrivers'),
    getMessages(),
    getFormatter(),
  ])
  const { data, error } = await db
    .from('external_driver_datasets')
    .select('driver_name,created_at,report')
    .eq('organization_id', context.active.id)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error('Driver dataset unavailable')
  if (!data) notFound()
  const report = driverReportSchema.parse(data.report)
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="forecasts"
        title={data.driver_name}
        description={t('savedAt', { time: format.dateTime(new Date(data.created_at), 'long') })}
        back={
          <Link href="/forecasts/drivers" className="underline">
            {t('title')}
          </Link>
        }
        actions={
          <>
            {isEditorRole(context.role) && (
              <Link href="/forecasts/drivers/new" className="underline">
                {t('new')}
              </Link>
            )}
            <HelpDisclosure label={t('methodDetails')}>
              <p>{t('method')}</p>
              <p>{t('limits')}</p>
            </HelpDisclosure>
          </>
        }
      />
      <NextIntlClientProvider messages={{ ExternalDrivers: messages.ExternalDrivers }}>
        <ExternalDriverReport report={report} />
      </NextIntlClientProvider>
      <details className="rounded-md border p-3 text-sm">
        <summary className="cursor-pointer">{t('evidence')}</summary>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {Object.entries(report.source).map(([key, value]) => (
            <div key={key} className="min-w-0">
              <dt className="text-xs text-muted-foreground">
                {t(`evidenceFields.${key as keyof typeof report.source}`)}
              </dt>
              <dd className="break-words">
                <bdi>{value}</bdi>
              </dd>
            </div>
          ))}
          <div>
            <dt className="text-xs text-muted-foreground">{t('importTime')}</dt>
            <dd>
              <bdi>{data.created_at}</bdi>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t('fingerprint')}</dt>
            <dd className="break-all">{report.fingerprint}</dd>
          </div>
        </dl>
        <p className="mt-3">{t('immutable')}</p>
      </details>
    </div>
  )
}
