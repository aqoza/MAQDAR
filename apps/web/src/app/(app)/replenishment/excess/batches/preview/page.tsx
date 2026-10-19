import { PageHeader } from '@/components/page-header'
import { ExcessDispositionBatchesHelp } from '@/components/excess-disposition-batches-help'
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
} from '@/lib/excess-disposition-batches'
import { type RawSearchParams } from '@/lib/master-data/list-params'
import { ExcessDispositionBatchEvidence } from '@/components/excess-disposition-batch-evidence'
import { ExcessDispositionBatchOverlap } from '@/components/excess-disposition-batch-overlap'
import { ExcessDispositionBatchSave } from '@/components/excess-disposition-batch-save'

export default async function BatchPreview({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  if (!isEditorRole(context.role)) redirect('/replenishment/excess/batches')
  const [t, messages, db] = await Promise.all([
    getTranslations('ExcessDispositionBatches'),
    getMessages(),
    createClient(),
  ])
  const parsed = batchInputSchema.safeParse(batchSelection(await searchParams))
  if (!parsed.success)
    return (
      <div className="space-y-3">
        <PageHeader
          pattern="replenishment"
          title={t('preview')}
          back={
            <Link className="underline" href="/replenishment/excess/batches/new">
              {t('choose')}
            </Link>
          }
        />
        <p role="alert">{t('invalidSelection')}</p>
      </div>
    )
  const result = await db.rpc('excess_disposition_handoff_batch_preview', {
    p_organization_id: context.active.id,
    p_handoff_ids: parsed.data,
  })
  if (result.error)
    return (
      <div className="space-y-3">
        <PageHeader
          pattern="replenishment"
          title={t('preview')}
          back={
            <Link className="underline" href={batchSelectionHref(parsed.data)}>
              {t('editSelection')}
            </Link>
          }
        />
        <p role="alert">{t(batchErrorKey(result.error.hint))}</p>
      </div>
    )
  const report = batchPreviewSchema.parse(result.data)
  return (
    <div className="space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('preview')}
        description={t('context')}
        help={<ExcessDispositionBatchesHelp />}
        back={
          <Link className="underline" href={batchSelectionHref(parsed.data)}>
            {t('editSelection')}
          </Link>
        }
      />
      <ExcessDispositionBatchEvidence report={report} />
      <ExcessDispositionBatchOverlap
        organizationId={context.active.id}
        handoffIds={parsed.data}
        excludeId={report.existing_batch_id ?? undefined}
      />
      {report.existing_batch_id ? (
        <>
          <p role="status">{t('existingNote')}</p>
          <Link
            className="underline"
            href={`/replenishment/excess/batches/${report.existing_batch_id}`}
          >
            {t('openExisting')}
          </Link>
        </>
      ) : (
        <>
          <NextIntlClientProvider
            messages={{ ExcessDispositionBatches: messages.ExcessDispositionBatches }}
          >
            <ExcessDispositionBatchSave
              organizationId={context.active.id}
              handoffIds={parsed.data}
            />
          </NextIntlClientProvider>
        </>
      )}
    </div>
  )
}
