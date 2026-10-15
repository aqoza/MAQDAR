import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getFormatter, getLocale, getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PolicyDecisionForm, PolicyProposalForm } from '@/components/policy-override-forms'
import { isEditorRole } from '@/lib/auth/roles'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { workbenchRowSchema, workbenchParams } from '@/lib/policy-workbench'
import { lastPage, type RawSearchParams } from '@/lib/master-data/list-params'

export default async function PolicyReview({
  params,
  searchParams,
}: {
  params: Promise<{ policyId: string }>
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { policyId } = await params
  if (!z.uuid().safeParse(policyId).success) notFound()
  const page = workbenchParams(await searchParams).page
  const [db, t, policy, locale, format, messages] = await Promise.all([
    createClient(),
    getTranslations('PolicyWorkbench'),
    getTranslations('InventoryPolicy'),
    getLocale(),
    getFormatter(),
    getMessages(),
  ])
  const { data, error } = await db
    .from('policy_workbench')
    .select('*')
    .eq('organization_id', context.active.id)
    .eq('id', policyId)
    .maybeSingle()
  if (error) throw new Error('Policy unavailable')
  if (!data) notFound()
  const row = workbenchRowSchema.parse(data)
  const history = await db
    .from('policy_override_history')
    .select('*', { count: 'exact' })
    .eq('organization_id', context.active.id)
    .eq('policy_id', policyId)
    .order('revision', { ascending: false })
    .range((page - 1) * 25, page * 25 - 1)
  const pages = lastPage(history.count ?? 0, 25)
  if (history.error?.code === 'PGRST103' || page > pages)
    redirect(`/forecasts/workbench/${policyId}`)
  if (history.error) throw new Error('Policy history unavailable')
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 })
  const amount = (value: string | null) =>
    value === null ? '—' : number.format(value as unknown as number)
  const actor = (id: string | null) =>
    id === context.userId ? t('you') : t('member', { id: id ?? '—' })
  const reviewer = ['owner', 'admin', 'approver'].includes(context.role ?? '')
  return (
    <div className="space-y-5">
      <Link href="/forecasts/workbench" className="text-sm underline">
        {t('back')}
      </Link>
      <h1 className="text-2xl font-semibold">{t('detailTitle', { item: row.item_code })}</h1>
      <p>
        {row.location_code} · {row.to_date} · {row.unit ?? policy('itemUnits')}
      </p>
      <p>{t('manualNote')}</p>
      <p role="status">{policy(`statuses.${row.status}`)}</p>
      <table className="w-full text-sm">
        <caption className="text-start font-semibold">{t('comparison')}</caption>
        <thead>
          <tr>
            <th className="p-2 text-start">{t('basis')}</th>
            <th className="p-2 text-start">{policy('lead_time')}</th>
            <th className="p-2 text-start">{policy('protection')}</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t">
            <th className="p-2 text-start">{t('calculated')}</th>
            <td className="p-2">{amount(row.calculated_reorder)}</td>
            <td className="p-2">{amount(row.calculated_maximum)}</td>
          </tr>
          <tr className="border-t">
            <th className="p-2 text-start">{t('lastApproved')}</th>
            <td className="p-2">{amount(row.approved_reorder)}</td>
            <td className="p-2">{amount(row.approved_maximum)}</td>
          </tr>
        </tbody>
      </table>
      <Link href={`/forecasts/policies/${row.run_id}`} className="underline">
        {t('evidence')}
      </Link>
      <NextIntlClientProvider messages={{ PolicyWorkbench: messages.PolicyWorkbench }}>
        {row.status === 'available' &&
          row.review_status !== 'pending' &&
          isEditorRole(context.role) && (
            <PolicyProposalForm
              organizationId={context.active.id}
              policyId={policyId}
              requestId={crypto.randomUUID()}
            />
          )}
        {row.review_status === 'pending' && <p>{t('pendingNote')}</p>}
        <h2 className="text-xl font-semibold">{t('history')}</h2>
        {!history.data?.length && <p>{t('noHistory')}</p>}
        {history.data?.map((proposal) => (
          <article className="space-y-3 rounded-xl border p-4" key={proposal.id}>
            <h3 className="font-semibold">
              {t('revision', { revision: proposal.revision ?? 0 })} ·{' '}
              {t(
                `statuses.${proposal.status as 'pending' | 'approved' | 'rejected' | 'withdrawn'}`,
              )}
            </h3>
            <p>
              {t('proposedValues', {
                reorder: amount(proposal.reorder_point),
                maximum: amount(proposal.order_up_to),
              })}
            </p>
            <p>
              {t('submitted', {
                actor: actor(proposal.submitted_by),
                time: format.dateTime(new Date(proposal.created_at!), 'long'),
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
            {proposal.status === 'pending' &&
              (proposal.submitted_by === context.userId || reviewer) && (
                <PolicyDecisionForm
                  organizationId={context.active!.id}
                  overrideId={proposal.id!}
                  requestId={crypto.randomUUID()}
                  withdrawal={proposal.submitted_by === context.userId}
                />
              )}
          </article>
        ))}
      </NextIntlClientProvider>
      <nav aria-label={t('pagination')} className="flex gap-4">
        {page > 1 && (
          <Link href={`?page=${page - 1}`} className="underline">
            {t('previous')}
          </Link>
        )}
        <span>{t('page', { page, pages })}</span>
        {page < pages && (
          <Link href={`?page=${page + 1}`} className="underline">
            {t('next')}
          </Link>
        )}
      </nav>
    </div>
  )
}
