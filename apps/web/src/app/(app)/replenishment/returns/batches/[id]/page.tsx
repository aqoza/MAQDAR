import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { DealerReturnBatchEvidence } from '@/components/dealer-return-batch-evidence'
import { DealerReturnBatchOverlap } from '@/components/dealer-return-batch-overlap'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { returnBatchesPath, returnBatchPayloadSchema } from '@/lib/dealer-return-batches'

export default async function ReturnBatchDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!z.guid().safeParse(id).success) notFound()
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const [db, t, format] = await Promise.all([
    createClient(),
    getTranslations('DealerReturnBatches'),
    getFormatter(),
  ])
  const { data, error } = await db
    .from('dealer_return_batch_list')
    .select('payload,handoff_ids,sources_available')
    .eq('organization_id', context.active.id)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error('Return batch unavailable')
  if (!data) notFound()
  const p = returnBatchPayloadSchema.parse(data.payload)
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('detail')}
        description={t('description')}
        back={
          <Link className="underline" href={returnBatchesPath}>
            {t('title')}
          </Link>
        }
        help={
          <HelpDisclosure>
            <p>{t('limits')}</p>
            <p>{t('retention')}</p>
          </HelpDisclosure>
        }
        actions={
          <>
            <a className="underline" href={'/api/dealer-return-batches/' + id + '/csv'}>
              {t('csv')}
            </a>
            <a className="underline" href={'/api/dealer-return-batches/' + id + '/json'}>
              {t('json')}
            </a>
          </>
        }
      />
      <p className="text-xs text-muted-foreground">
        {t(data.sources_available ? 'sourcesAvailable' : 'sourcesUnavailable')}
      </p>
      <DealerReturnBatchEvidence report={p} />
      <DealerReturnBatchOverlap
        organizationId={context.active.id}
        handoffIds={data.handoff_ids ?? []}
        excludeId={id}
      />
      <section className="space-y-2 break-words workspace-panel">
        <h2 className="text-section-title">{t('saved')}</h2>
        <p>
          {format.dateTime(new Date(p.created_at), 'long')} ·{' '}
          <bdi>{p.created_by_email ?? t('notSupplied')}</bdi>
        </p>
        <p className="break-all text-xs">
          {t('identifier')}: {p.batch_id}
        </p>
      </section>
    </div>
  )
}
