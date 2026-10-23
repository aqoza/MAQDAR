import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
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
} from '@/lib/regional-batches'
import { type RawSearchParams } from '@/lib/master-data/list-params'
import { RegionalBatchEvidence } from '@/components/regional-batch-evidence'
import { RegionalBatchOverlap } from '@/components/regional-batch-overlap'
import { RegionalBatchSave } from '@/components/regional-batch-save'

export default async function BatchPreview({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  if (!isEditorRole(context.role)) redirect('/replenishment/regional-stock/sourcing/batches')
  const [t, messages, db] = await Promise.all([
    getTranslations('RegionalBatches'),
    getMessages(),
    createClient(),
  ])
  const parsed = batchInputSchema.safeParse(batchSelection(await searchParams))
  if (!parsed.success)
    return (
      <div className="space-y-3">
        <PageHeader pattern="replenishment" title={t('preview')} />
        <p role="alert">{t('invalidSelection')}</p>
        <Link className="underline" href="/replenishment/regional-stock/sourcing/batches/new">
          {t('choose')}
        </Link>
      </div>
    )
  const result = await db.rpc('regional_handoff_batch_preview', {
    p_organization_id: context.active.id,
    p_handoff_ids: parsed.data,
  })
  if (result.error)
    return (
      <div className="space-y-3">
        <PageHeader pattern="replenishment" title={t('preview')} />
        <p role="alert">{t(batchErrorKey(result.error.hint))}</p>
        <Link className="underline" href={batchSelectionHref(parsed.data)}>
          {t('editSelection')}
        </Link>
      </div>
    )
  const report = batchPreviewSchema.parse(result.data)
  return (
    <div className="min-w-0 space-y-4 wrap-anywhere">
      <PageHeader
        pattern="replenishment"
        back={
          <Link className="underline" href={batchSelectionHref(parsed.data)}>
            {t('editSelection')}
          </Link>
        }
        title={t('preview')}
        help={
          <HelpDisclosure>
            <p>{t('description')}</p>
          </HelpDisclosure>
        }
      />

      <RegionalBatchEvidence report={report} />
      <RegionalBatchOverlap
        organizationId={context.active.id}
        handoffIds={parsed.data}
        excludeId={report.existing_batch_id ?? undefined}
      />
      {report.existing_batch_id ? (
        <>
          <p role="status">{t('existingNote')}</p>
          <Link
            className="underline"
            href={`/replenishment/regional-stock/sourcing/batches/${report.existing_batch_id}`}
          >
            {t('openExisting')}
          </Link>
        </>
      ) : (
        <>
          <p>{t('saveNote')}</p>
          <NextIntlClientProvider messages={{ RegionalBatches: messages.RegionalBatches }}>
            <RegionalBatchSave organizationId={context.active.id} handoffIds={parsed.data} />
          </NextIntlClientProvider>
        </>
      )}
    </div>
  )
}
