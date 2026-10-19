import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { ExcessDispositionHandoffsHelp } from '@/components/excess-disposition-handoffs-help'
import { ExcessDispositionEvidence } from '@/components/excess-disposition-evidence'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { handoffPayloadSchema } from '@/lib/excess-disposition-handoffs'
import { formatCostDecimal } from '@/lib/purchase-costs'

export async function generateMetadata() {
  return { title: (await getTranslations('ExcessDispositionHandoffs'))('title') }
}
export default async function Handoff({ params }: { params: Promise<{ handoffId: string }> }) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { handoffId } = await params
  if (!z.guid().safeParse(handoffId).success) notFound()
  const [db, t, dt, format, locale] = await Promise.all([
    createClient(),
    getTranslations('ExcessDispositionHandoffs'),
    getTranslations('ExcessDisposition'),
    getFormatter(),
    getLocale(),
  ])
  const [record, current] = await Promise.all([
    db
      .from('excess_disposition_handoffs')
      .select('payload')
      .eq('organization_id', context.active.id)
      .eq('id', handoffId)
      .maybeSingle(),
    db
      .from('excess_disposition_handoff_list')
      .select('selected')
      .eq('organization_id', context.active.id)
      .eq('id', handoffId)
      .maybeSingle(),
  ])
  if (record.error || current.error) throw new Error('Disposition handoff unavailable')
  if (!record.data || !current.data) notFound()
  const p = handoffPayloadSchema.parse(record.data.payload)
  const bt = await getTranslations('ExcessDispositionBatches')
  const d = p.disposition
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('detailTitle', { item: d.item_code })}
        description={t('context')}
        help={<ExcessDispositionHandoffsHelp />}
        back={
          <Link className="underline" href="/replenishment/excess/handoffs">
            {t('back')}
          </Link>
        }
        actions={
          <>
            {['owner', 'admin', 'planner'].includes(context.active.role) &&
              current.data.selected && (
                <Link
                  className="rounded-md border bg-background px-3 py-2"
                  href={`/replenishment/excess/batches/new?handoff=${handoffId}`}
                >
                  {bt('create')}
                </Link>
              )}
            <a
              download
              className="rounded-md bg-primary px-3 py-2 text-primary-foreground"
              href={`/api/excess-disposition-handoffs/${handoffId}/json`}
            >
              {t('json')}
            </a>
            <a
              download
              className="rounded-md border bg-background px-3 py-2"
              href={`/api/excess-disposition-handoffs/${handoffId}/csv`}
            >
              {t('csv')}
            </a>
          </>
        }
      />
      <section className="workspace-panel space-y-3">
        <h2 className="text-section-title">{dt(`kinds.${d.kind}`)}</h2>
        <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t('quantity')}</dt>
            <dd className="break-words text-evidence-value">
              <bdi>
                {formatCostDecimal(d.quantity, locale, 100)} {d.unit}
              </bdi>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t('referenceValue')}</dt>
            <dd className="break-words text-evidence-value">
              <bdi>
                {formatCostDecimal(d.reference_value, locale, 100)} {d.currency}
              </bdi>
            </dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">{t('valueNote')}</p>
        <p>{t('savedAt', { time: format.dateTime(new Date(p.created_at), 'long') })}</p>
        <p className="break-all text-xs text-muted-foreground">
          {t('identity', { id: p.handoff_id })}
        </p>
        <p className="whitespace-pre-wrap break-words">
          {t('reason')}: {p.proposal.reason}
        </p>
        <p className="whitespace-pre-wrap break-words">
          {t('approvalReason')}: {p.proposal.approval_reason}
        </p>
        <p className="whitespace-pre-wrap break-words">
          {t('assessmentReason')}: {p.assessment.reason}
        </p>
        <Link
          className="inline-flex underline"
          href={`/replenishment/excess/review/${p.proposal.id}`}
        >
          {t('proposal')}
        </Link>
      </section>
      <section className="workspace-panel space-y-2" aria-label={t('currentContext')}>
        <h2 className="text-section-title">{t('currentContext')}</h2>
        <p role="status">{t(current.data.selected ? 'current' : 'historical')}</p>
        <p className="text-xs text-muted-foreground">{t('selectionNote')}</p>
      </section>
      <ExcessDispositionEvidence
        source={{
          assessment_id: p.assessment.id,
          location_id: d.location_id,
          location_code: d.location_code,
          cutoff: d.cutoff,
          matches: false,
          line: p.line,
        }}
      />
      <details className="workspace-panel">
        <summary className="cursor-pointer">{t('inputs')}</summary>
        <pre className="mt-2 max-w-full whitespace-pre-wrap break-all text-xs">
          {JSON.stringify(p, null, 2)}
        </pre>
      </details>
    </div>
  )
}
