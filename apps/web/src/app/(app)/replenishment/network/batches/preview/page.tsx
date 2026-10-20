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
} from '@/lib/network-batches'
import { type RawSearchParams } from '@/lib/master-data/list-params'
import { NetworkBatchEvidence } from '@/components/network-batch-evidence'
import { NetworkBatchOverlap } from '@/components/network-batch-overlap'
import { NetworkBatchSave } from '@/components/network-batch-save'

export default async function BatchPreview({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  if (!isEditorRole(context.role)) redirect('/replenishment/network/batches')
  const [t, messages, db] = await Promise.all([
    getTranslations('NetworkBatches'),
    getMessages(),
    createClient(),
  ])
  const parsed = batchInputSchema.safeParse(batchSelection(await searchParams))
  if (!parsed.success)
    return (
      <div className="space-y-3">
        <PageHeader pattern="replenishment" title={t('preview')} />
        <p role="alert">{t('invalidSelection')}</p>
        <Link className="underline" href="/replenishment/network/batches/new">
          {t('choose')}
        </Link>
      </div>
    )
  const result = await db.rpc('network_handoff_batch_preview', {
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

      <NetworkBatchEvidence report={report} />
      <NetworkBatchOverlap
        organizationId={context.active.id}
        handoffIds={parsed.data}
        excludeId={report.existing_batch_id ?? undefined}
      />
      {report.existing_batch_id ? (
        <>
          <p role="status">{t('existingNote')}</p>
          <Link
            className="underline"
            href={`/replenishment/network/batches/${report.existing_batch_id}`}
          >
            {t('openExisting')}
          </Link>
        </>
      ) : (
        <>
          <p>{t('saveNote')}</p>
          <NextIntlClientProvider messages={{ NetworkBatches: messages.NetworkBatches }}>
            <NetworkBatchSave organizationId={context.active.id} handoffIds={parsed.data} />
          </NextIntlClientProvider>
        </>
      )}
    </div>
  )
}
