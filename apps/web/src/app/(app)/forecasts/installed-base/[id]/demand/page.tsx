import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { InstalledBaseDemandForm } from '@/components/installed-base-demand-form'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'
import { populationReportSchema } from '@/lib/installed-base'
import { reportingDay } from '@/lib/dashboard'

export default async function NewInstalledDemand({ params }: { params: Promise<{ id: string }> }) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  if (!isEditorRole(context.role)) notFound()
  const { id } = await params
  if (!z.guid().safeParse(id).success) notFound()
  const [db, t, messages] = await Promise.all([
    createClient(),
    getTranslations('InstalledBaseDemand'),
    getMessages(),
  ])
  const { data, error } = await db
    .from('installed_base_datasets')
    .select('dataset_name,report')
    .eq('organization_id', context.active.id)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error('Population source unavailable')
  if (!data) notFound()
  const population = populationReportSchema.parse(data.report)
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="forecasts"
        title={t('new')}
        description={data.dataset_name}
        back={
          <Link href={`/forecasts/installed-base/${id}`} className="underline">
            {t('population')}
          </Link>
        }
        actions={
          <>
            <Link href="/forecasts/installed-base/demand" className="underline">
              {t('title')}
            </Link>
            <HelpDisclosure label={t('methodDetails')}>
              <p>{t('method')}</p>
              <p>{t('limits')}</p>
            </HelpDisclosure>
          </>
        }
      />
      <NextIntlClientProvider
        messages={{
          InstalledBaseDemand: messages.InstalledBaseDemand,
          InstalledBase: messages.InstalledBase,
        }}
      >
        <InstalledBaseDemandForm
          organizationId={context.active.id}
          requestId={crypto.randomUUID()}
          datasetId={id}
          population={population}
          cutoff={reportingDay(new Date(), population.source.time_zone)}
        />
      </NextIntlClientProvider>
    </div>
  )
}
