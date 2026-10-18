import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { EventSupplierForm } from '@/components/event-supplier-form'
import { eventDraftReportSchema } from '@/lib/event-replenishment'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'

export default async function NewEventSupplier({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { draft } = await searchParams
  if (!z.guid().safeParse(draft).success) notFound()
  const [db, t, messages] = await Promise.all([
    createClient(),
    getTranslations('EventSuppliers'),
    getMessages(),
  ])
  const { data, error } = await db
    .from('event_replenishment_drafts')
    .select('report')
    .eq('organization_id', context.active.id)
    .eq('id', draft!)
    .maybeSingle()
  if (error) throw new Error('Event replenishment source unavailable')
  if (!data) notFound()
  const report = eventDraftReportSchema.parse(data.report)
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('new')}
        description={<span className="break-words">{report.scenario.event.input.name}</span>}
        actions={
          <>
            <Link className="underline" href={`/replenishment/events/${draft}`}>
              {t('source')}
            </Link>
            <Link className="underline" href={`/replenishment/events/suppliers?draft=${draft}`}>
              {t('history')}
            </Link>
          </>
        }
      />
      <p className="text-sm">
        <bdi>
          {report.scenario.event.source.item_code} · {report.scenario.event.source.location_code} ·{' '}
          {report.scenario.event.input.unit}
        </bdi>{' '}
        · {t('cutoff', { date: report.scenario.event.source.cutoff })}
      </p>
      <Link
        className="inline-block underline"
        href={`/suppliers/supplier-items?q=${encodeURIComponent(report.scenario.event.source.item_code)}`}
      >
        {t('findTerms')}
      </Link>
      {isEditorRole(context.role) ? (
        <NextIntlClientProvider
          messages={{
            EventSuppliers: messages.EventSuppliers,
            EventReplenishment: messages.EventReplenishment,
            Common: messages.Common,
          }}
        >
          <EventSupplierForm
            organizationId={context.active.id}
            draftId={draft!}
            cutoff={report.scenario.event.source.cutoff}
            requestId={crypto.randomUUID()}
          />
        </NextIntlClientProvider>
      ) : (
        <p>{t('readOnly')}</p>
      )}
    </div>
  )
}
