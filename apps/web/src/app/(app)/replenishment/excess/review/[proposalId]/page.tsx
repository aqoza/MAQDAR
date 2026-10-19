import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getFormatter, getLocale, getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { ExcessDispositionHelp } from '@/components/excess-disposition-help'
import { ExcessDispositionEvidence } from '@/components/excess-disposition-evidence'
import { ExcessDispositionHandoffForm } from '@/components/excess-disposition-handoff-form'
import { ExcessDispositionDecision } from '@/components/excess-disposition-forms'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { dispositionRowSchema, dispositionSourceSchema } from '@/lib/excess-disposition'
import { formatCostDecimal } from '@/lib/purchase-costs'

export async function generateMetadata() {
  return { title: (await getTranslations('ExcessDisposition'))('title') }
}
export default async function Disposition({ params }: { params: Promise<{ proposalId: string }> }) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { proposalId } = await params
  if (!z.guid().safeParse(proposalId).success) notFound()
  const [db, t, messages, format, locale] = await Promise.all([
    createClient(),
    getTranslations('ExcessDisposition'),
    getMessages(),
    getFormatter(),
    getLocale(),
  ])
  const [record, result] = await Promise.all([
    db
      .from('excess_disposition_proposals')
      .select(
        'id,assessment_id,item_id,line,reason,submitted_by,created_at,decided_by,decided_at,decision_reason',
      )
      .eq('organization_id', context.active.id)
      .eq('id', proposalId)
      .maybeSingle(),
    db
      .from('excess_disposition_list')
      .select('*')
      .eq('organization_id', context.active.id)
      .eq('id', proposalId)
      .maybeSingle(),
  ])
  if (record.error || result.error) throw new Error('Disposition unavailable')
  if (!record.data || !result.data) notFound()
  const proposal = record.data
  const row = dispositionRowSchema.parse(result.data)
  let matches = false
  if (row.status === 'pending') {
    const current = await db.rpc('excess_disposition_preview', {
      p_organization_id: context.active.id,
      p_assessment_id: row.assessment_id,
      p_item_id: row.item_id,
    })
    if (current.error && !['MQ404', 'MQ422'].includes(current.error.code))
      throw new Error('Disposition evidence unavailable')
    if (!current.error) matches = dispositionSourceSchema.parse(current.data).matches
  }
  const handoff = await db
    .from('excess_disposition_handoffs')
    .select('id')
    .eq('organization_id', context.active.id)
    .eq('proposal_id', proposalId)
    .maybeSingle()
  if (handoff.error) throw new Error('Disposition handoff unavailable')
  const ht = await getTranslations('ExcessDispositionHandoffs')
  const editor = ['owner', 'admin', 'planner'].includes(context.active.role)
  const source = dispositionSourceSchema.parse({ ...row, matches, line: proposal.line })
  const withdrawal = proposal.submitted_by === context.userId
  const reviewer = ['owner', 'admin', 'approver'].includes(context.active.role)
  const actor = (id: string | null) =>
    id === context.userId ? t('you') : t('member', { id: id ?? '—' })
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('detail', { item: row.item_code })}
        description={t('context')}
        help={<ExcessDispositionHelp />}
        back={
          <Link className="underline" href="/replenishment/excess/review">
            {t('title')}
          </Link>
        }
      />
      <section className="workspace-panel space-y-3">
        <h2 className="text-section-title">
          {t('revision', { revision: row.revision })} · {t(`statuses.${row.status}`)}
        </h2>
        {row.selected && <p role="status">{t('selected')}</p>}
        {row.status === 'approved' && !row.selected && <p>{t('historical')}</p>}
        <dl className="grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">{t('kind')}</dt>
            <dd className="text-evidence-value">{t(`kinds.${row.kind}`)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t('quantity')}</dt>
            <dd className="break-words text-evidence-value">
              <bdi>
                {formatCostDecimal(row.quantity, locale, 100)} {row.unit}
              </bdi>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t('referenceValue')}</dt>
            <dd className="break-words text-evidence-value">
              <bdi>
                {formatCostDecimal(row.reference_value, locale, 100)} {row.currency}
              </bdi>
            </dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">{t('valueNote')}</p>
        <p>
          {t('submitted', {
            actor: actor(proposal.submitted_by),
            time: format.dateTime(new Date(proposal.created_at), 'long'),
          })}
        </p>
        <p className="whitespace-pre-wrap break-words">
          {t('reason')}: {proposal.reason}
        </p>
        {proposal.decided_at && (
          <>
            <p>
              {t('decided', {
                actor: actor(proposal.decided_by),
                time: format.dateTime(new Date(proposal.decided_at), 'long'),
              })}
            </p>
            <p className="whitespace-pre-wrap break-words">
              {t('decisionReason')}: {proposal.decision_reason}
            </p>
          </>
        )}
        <Link
          className="underline"
          href={`/replenishment/excess/review?assessment=${row.assessment_id}&item=${row.item_id}`}
        >
          {t('lineHistory')}
        </Link>
      </section>
      {handoff.data ? (
        <Link
          className="inline-flex underline"
          href={`/replenishment/excess/handoffs/${handoff.data.id}`}
        >
          {ht('open')}
        </Link>
      ) : row.selected && editor ? (
        <NextIntlClientProvider
          messages={{ ExcessDispositionHandoffs: messages.ExcessDispositionHandoffs }}
        >
          <ExcessDispositionHandoffForm organizationId={context.active.id} proposalId={row.id} />
        </NextIntlClientProvider>
      ) : null}
      <ExcessDispositionEvidence source={source} />
      {row.status === 'pending' && (
        <>
          <p role={matches ? 'status' : 'alert'}>{t(matches ? 'current' : 'changed')}</p>
          {(withdrawal || reviewer) && (
            <NextIntlClientProvider messages={{ ExcessDisposition: messages.ExcessDisposition }}>
              <ExcessDispositionDecision
                organizationId={context.active.id}
                proposalId={row.id}
                requestId={crypto.randomUUID()}
                withdrawal={withdrawal}
                approveBlocked={!matches}
              />
            </NextIntlClientProvider>
          )}
        </>
      )}
    </div>
  )
}
