import Link from 'next/link'
import { redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { DealerReturnBatchEvidence } from '@/components/dealer-return-batch-evidence'
import { DealerReturnBatchOverlap } from '@/components/dealer-return-batch-overlap'
import { DealerReturnBatchSave } from '@/components/dealer-return-batch-save'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'
import {
  batchInputSchema,
  batchSelection,
  returnBatchesPath,
  returnBatchSelectionHref,
  returnBatchErrorKey,
  returnBatchPreviewSchema,
} from '@/lib/dealer-return-batches'
import { type RawSearchParams } from '@/lib/master-data/list-params'

export default async function ReturnBatchPreview({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  if (!isEditorRole(context.role)) redirect(returnBatchesPath)
  const [db, t, messages] = await Promise.all([
    createClient(),
    getTranslations('DealerReturnBatches'),
    getMessages(),
  ])
  const parsed = batchInputSchema.safeParse(batchSelection(await searchParams))
  const result = parsed.success
    ? await db.rpc('dealer_return_batch_preview', {
        p_organization_id: context.active.id,
        p_handoff_ids: parsed.data,
      })
    : null
  const report = result && !result.error ? returnBatchPreviewSchema.parse(result.data) : null
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('preview')}
        description={t('description')}
        back={
          <Link
            className="underline"
            href={returnBatchSelectionHref(parsed.success ? parsed.data : [])}
          >
            {t('editSelection')}
          </Link>
        }
        help={
          <HelpDisclosure>
            <p>{t('limits')}</p>
            <p>{t('retention')}</p>
          </HelpDisclosure>
        }
      />
      {!report ? (
        <p role="alert">
          {t(parsed.success ? returnBatchErrorKey(result?.error?.hint) : 'invalidSelection')}
        </p>
      ) : (
        <>
          <DealerReturnBatchEvidence report={report} />
          <DealerReturnBatchOverlap
            organizationId={context.active.id}
            handoffIds={parsed.success ? parsed.data : []}
            excludeId={report.existing_batch_id ?? undefined}
          />
          {report.existing_batch_id ? (
            <>
              <p role="status">{t('existingNote')}</p>
              <Link
                className="inline-flex min-h-11 items-center underline"
                href={returnBatchesPath + '/' + report.existing_batch_id}
              >
                {t('openExisting')}
              </Link>
            </>
          ) : (
            <NextIntlClientProvider
              messages={{ DealerReturnBatches: messages.DealerReturnBatches }}
            >
              <DealerReturnBatchSave
                organizationId={context.active.id}
                handoffIds={parsed.success ? parsed.data : []}
              />
            </NextIntlClientProvider>
          )}
        </>
      )}
    </div>
  )
}
