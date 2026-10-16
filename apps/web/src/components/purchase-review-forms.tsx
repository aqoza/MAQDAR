'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { idleState } from '@/lib/forms'
import { submitProposal, decideProposal } from '@/app/(app)/replenishment/review/actions'

export function PurchaseProposalForm({
  organizationId,
  estimateId,
  requestId,
}: {
  organizationId: string
  estimateId: string
  requestId: string
}) {
  const t = useTranslations('PurchaseReview')
  const [state, action, pending] = useActionState(submitProposal, idleState)
  return (
    <form action={action} aria-label={t('propose')} className="space-y-4 rounded-xl border p-4">
      <h2 className="text-xl font-semibold">{t('propose')}</h2>
      <p>{t('proposalNote')}</p>
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="estimate_id" value={estimateId} />
      <input type="hidden" name="request_id" value={requestId} />
      <label className="grid gap-1">
        {t('reason')}
        <textarea
          name="reason"
          required
          maxLength={2000}
          defaultValue={state.values?.reason ?? ''}
          className="rounded-md border bg-background p-2"
        />
      </label>
      <button
        disabled={pending}
        className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
      >
        {t(pending ? 'saving' : 'submit')}
      </button>
      {state.message && <p role="alert">{state.message}</p>}
    </form>
  )
}

export function PurchaseDecisionForm({
  organizationId,
  proposalId,
  requestId,
  withdrawal,
  approveBlocked,
}: {
  organizationId: string
  proposalId: string
  requestId: string
  withdrawal: boolean
  approveBlocked: boolean
}) {
  const t = useTranslations('PurchaseReview')
  const [state, action, pending] = useActionState(decideProposal, idleState)
  return (
    <form
      action={action}
      aria-label={t(withdrawal ? 'withdraw' : 'review')}
      className="space-y-3 rounded-lg border p-3"
    >
      <h3 className="font-semibold">{t(withdrawal ? 'withdraw' : 'review')}</h3>
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="proposal_id" value={proposalId} />
      <input type="hidden" name="request_id" value={requestId} />
      {withdrawal ? (
        <input type="hidden" name="decision" value="withdrawn" />
      ) : (
        <label className="grid gap-1">
          {t('decision')}
          <select
            name="decision"
            defaultValue={approveBlocked ? 'rejected' : (state.values?.decision ?? 'approved')}
            className="rounded-md border bg-background p-2"
          >
            <option value="approved" disabled={approveBlocked}>
              {t('approve')}
            </option>
            <option value="rejected">{t('reject')}</option>
          </select>
        </label>
      )}
      <label className="grid gap-1">
        {t('decisionReason')}
        <textarea
          name="reason"
          required
          maxLength={2000}
          defaultValue={state.values?.reason ?? ''}
          className="rounded-md border bg-background p-2"
        />
      </label>
      <button
        disabled={pending}
        className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
      >
        {t(pending ? 'saving' : withdrawal ? 'withdraw' : 'recordDecision')}
      </button>
      {state.message && <p role="alert">{state.message}</p>}
    </form>
  )
}
