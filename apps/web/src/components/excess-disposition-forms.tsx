'use client'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { idleState } from '@/lib/forms'
import { DISPOSITION_KINDS } from '@/lib/excess-disposition'
import {
  submitDisposition,
  decideDisposition,
} from '@/app/(app)/replenishment/excess/review/actions'

export function ExcessDispositionForm({
  organizationId,
  assessmentId,
  itemId,
  requestId,
}: {
  organizationId: string
  assessmentId: string
  itemId: string
  requestId: string
}) {
  const t = useTranslations('ExcessDisposition')
  const [state, action, pending] = useActionState(submitDisposition, idleState)
  return (
    <form action={action} aria-label={t('propose')} className="workspace-panel space-y-3">
      <h2 className="text-section-title">{t('propose')}</h2>
      {Object.entries({
        organization_id: organizationId,
        assessment_id: assessmentId,
        item_id: itemId,
        request_id: requestId,
      }).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          {t('kind')}
          <select
            key={state.values?.kind ?? ''}
            name="kind"
            required
            defaultValue={state.values?.kind ?? ''}
            className="rounded-md border bg-background p-2"
          >
            <option value="">{t('chooseKind')}</option>
            {DISPOSITION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`kinds.${kind}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          {t('quantity')}
          <input
            name="quantity"
            inputMode="decimal"
            required
            maxLength={19}
            defaultValue={state.values?.quantity ?? ''}
            className="min-w-0 rounded-md border bg-background p-2"
          />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">{t('quantityHint')}</p>
      <label className="grid gap-1">
        {t('reason')}
        <textarea
          name="reason"
          required
          maxLength={2000}
          rows={2}
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
export function ExcessDispositionDecision({
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
  const t = useTranslations('ExcessDisposition')
  const [state, action, pending] = useActionState(decideDisposition, idleState)
  return (
    <form
      action={action}
      aria-label={t(withdrawal ? 'withdraw' : 'review')}
      className="workspace-panel space-y-3"
    >
      <h2 className="text-section-title">{t(withdrawal ? 'withdraw' : 'review')}</h2>
      {Object.entries({
        organization_id: organizationId,
        proposal_id: proposalId,
        request_id: requestId,
      }).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {withdrawal ? (
        <input type="hidden" name="decision" value="withdrawn" />
      ) : (
        <label className="grid gap-1">
          {t('decision')}
          <select
            key={approveBlocked ? 'rejected' : (state.values?.decision ?? 'approved')}
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
          rows={2}
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
