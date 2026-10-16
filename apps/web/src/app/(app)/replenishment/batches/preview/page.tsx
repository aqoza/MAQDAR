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
} from '@/lib/handoff-batches'
import { type RawSearchParams } from '@/lib/master-data/list-params'
import { HandoffBatchEvidence } from '@/components/handoff-batch-evidence'
import { HandoffBatchOverlap } from '@/components/handoff-batch-overlap'
import { HandoffBatchSave } from '@/components/handoff-batch-save'

export default async function BatchPreview({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  if (!isEditorRole(context.role)) redirect('/replenishment/batches')
  const [t, messages, db] = await Promise.all([
    getTranslations('HandoffBatches'),
    getMessages(),
    createClient(),
  ])
  const parsed = batchInputSchema.safeParse(batchSelection(await searchParams))
  if (!parsed.success)
    return (
      <div className="space-y-3">
        <p role="alert">{t('invalidSelection')}</p>
        <Link className="underline" href="/replenishment/batches/new">
          {t('choose')}
        </Link>
      </div>
    )
  const result = await db.rpc('purchase_handoff_batch_preview', {
    p_organization_id: context.active.id,
    p_handoff_ids: parsed.data,
  })
  if (result.error)
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">{t('preview')}</h1>
        <p role="alert">{t(batchErrorKey(result.error.hint))}</p>
        <Link className="underline" href={batchSelectionHref(parsed.data)}>
          {t('editSelection')}
        </Link>
      </div>
    )
  const report = batchPreviewSchema.parse(result.data)
  return (
    <div className="space-y-5">
      <Link className="underline" href={batchSelectionHref(parsed.data)}>
        {t('editSelection')}
      </Link>
      <h1 className="text-2xl font-semibold">{t('preview')}</h1>
      <p>{t('description')}</p>
      <HandoffBatchEvidence report={report} />
      <HandoffBatchOverlap
        organizationId={context.active.id}
        handoffIds={parsed.data}
        excludeId={report.existing_batch_id ?? undefined}
      />
      {report.existing_batch_id ? (
        <>
          <p role="status">{t('existingNote')}</p>
          <Link className="underline" href={`/replenishment/batches/${report.existing_batch_id}`}>
            {t('openExisting')}
          </Link>
        </>
      ) : (
        <>
          <p>{t('saveNote')}</p>
          <NextIntlClientProvider messages={{ HandoffBatches: messages.HandoffBatches }}>
            <HandoffBatchSave organizationId={context.active.id} handoffIds={parsed.data} />
          </NextIntlClientProvider>
        </>
      )}
    </div>
  )
}
