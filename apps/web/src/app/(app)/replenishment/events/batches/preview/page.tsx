import { PageHeader } from '@/components/page-header'
import { EventHandoffBatchesHelp } from '@/components/event-handoff-batches-help'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'
import {
  batchInputSchema,
  batchSelection,
  batchSelectionHref,
  batchErrorKey,
  batchPreviewSchema,
} from '@/lib/event-handoff-batches'
import { type RawSearchParams } from '@/lib/master-data/list-params'
import { EventHandoffBatchEvidence } from '@/components/event-handoff-batch-evidence'
import { EventHandoffBatchOverlap } from '@/components/event-handoff-batch-overlap'
import { EventHandoffBatchSave } from '@/components/event-handoff-batch-save'

export default async function BatchPreview({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  if (!isEditorRole(context.role)) redirect('/replenishment/events/batches')
  const [t, messages, db] = await Promise.all([
    getTranslations('EventHandoffBatches'),
    getMessages(),
    createClient(),
  ])
  const parsed = batchInputSchema.safeParse(batchSelection(await searchParams))
  if (!parsed.success)
    return (
      <div className="space-y-3">
        <p role="alert">{t('invalidSelection')}</p>
        <Link className="underline" href="/replenishment/events/batches/new">
          {t('choose')}
        </Link>
      </div>
    )
  const result = await db.rpc('event_purchase_handoff_batch_preview', {
    p_organization_id: context.active.id,
    p_handoff_ids: parsed.data,
  })
  if (result.error)
    return (
      <div className="space-y-3">
        <h1 className="text-page-title">{t('preview')}</h1>
        <p role="alert">{t(batchErrorKey(result.error.hint))}</p>
        <Link className="underline" href={batchSelectionHref(parsed.data)}>
          {t('editSelection')}
        </Link>
      </div>
    )
  const report = batchPreviewSchema.parse(result.data)
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('preview')}
        description={t('context')}
        help={<EventHandoffBatchesHelp />}
        actions={
          <Link className="underline" href={batchSelectionHref(parsed.data)}>
            {t('editSelection')}
          </Link>
        }
      />
      <EventHandoffBatchEvidence report={report} />
      <EventHandoffBatchOverlap
        organizationId={context.active.id}
        handoffIds={parsed.data}
        excludeId={report.existing_batch_id ?? undefined}
      />
      {report.existing_batch_id ? (
        <>
          <p role="status">{t('existingNote')}</p>
          <Link
            className="underline"
            href={`/replenishment/events/batches/${report.existing_batch_id}`}
          >
            {t('openExisting')}
          </Link>
        </>
      ) : (
        <>
          <NextIntlClientProvider messages={{ EventHandoffBatches: messages.EventHandoffBatches }}>
            <EventHandoffBatchSave organizationId={context.active.id} handoffIds={parsed.data} />
          </NextIntlClientProvider>
        </>
      )}
    </div>
  )
}
