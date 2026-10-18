'use client'

import { useActionState, useId } from 'react'
import { useTranslations } from 'next-intl'
import { idleState } from '@/lib/forms'
import { submitOverride, decideOverride } from '@/app/(app)/forecasts/workbench/actions'

export function PolicyProposalForm({
  organizationId,
  policyId,
  requestId,
}: {
  organizationId: string
  policyId: string
  requestId: string
}) {
  const t = useTranslations('PolicyWorkbench')
  const formId = useId()
  const [state, action, pending] = useActionState(submitOverride, idleState)
  return (
    <form action={action} aria-label={t('propose')} className="space-y-4 workspace-panel">
      <h2 className="text-section-title">{t('propose')}</h2>
      <p>{t('proposalNote')}</p>
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="policy_id" value={policyId} />
      <input type="hidden" name="request_id" value={requestId} />
      {(['reorder_point', 'order_up_to'] as const).map((name) => (
        <label className="grid gap-1" key={name}>
          <span id={`${formId}-${name}-label`}>{t(name)}</span>
          <input
            name={name}
            aria-labelledby={`${formId}-${name}-label`}
            aria-invalid={state.fieldErrors?.[name] ? true : undefined}
            aria-describedby={state.fieldErrors?.[name] ? `${formId}-${name}-error` : undefined}
            inputMode="decimal"
            required
            maxLength={40}
            defaultValue={state.values?.[name] ?? ''}
            className="rounded-md border bg-background p-2 aria-invalid:border-destructive"
          />
          {state.fieldErrors?.[name] && (
            <span id={`${formId}-${name}-error`} className="text-sm text-destructive">
              {state.fieldErrors[name]}
            </span>
          )}
        </label>
      ))}
      <label className="grid gap-1">
        <span id={`${formId}-reason-label`}>{t('reason')}</span>
        <textarea
          name="reason"
          aria-labelledby={`${formId}-reason-label`}
          aria-invalid={state.fieldErrors?.reason ? true : undefined}
          aria-describedby={state.fieldErrors?.reason ? `${formId}-reason-error` : undefined}
          required
          maxLength={2000}
          defaultValue={state.values?.reason ?? ''}
          className="rounded-md border bg-background p-2 aria-invalid:border-destructive"
        />
        {state.fieldErrors?.reason && (
          <span id={`${formId}-reason-error`} className="text-sm text-destructive">
            {state.fieldErrors.reason}
          </span>
        )}
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

export function PolicyDecisionForm({
  organizationId,
  overrideId,
  requestId,
  withdrawal,
}: {
  organizationId: string
  overrideId: string
  requestId: string
  withdrawal: boolean
}) {
  const t = useTranslations('PolicyWorkbench')
  const formId = useId()
  const [state, action, pending] = useActionState(decideOverride, idleState)
  return (
    <form
      action={action}
      aria-label={t(withdrawal ? 'withdraw' : 'review')}
      className="space-y-3 rounded-lg border bg-card p-3"
    >
      <h3 className="text-subsection-title">{t(withdrawal ? 'withdraw' : 'review')}</h3>
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="override_id" value={overrideId} />
      <input type="hidden" name="request_id" value={requestId} />
      {withdrawal ? (
        <input type="hidden" name="decision" value="withdrawn" />
      ) : (
        <label className="grid gap-1">
          <span id={`${formId}-decision-label`}>{t('decision')}</span>
          <select
            name="decision"
            aria-labelledby={`${formId}-decision-label`}
            aria-invalid={state.fieldErrors?.decision ? true : undefined}
            aria-describedby={state.fieldErrors?.decision ? `${formId}-decision-error` : undefined}
            defaultValue={state.values?.decision ?? 'approved'}
            className="rounded-md border bg-background p-2 aria-invalid:border-destructive"
          >
            <option value="approved">{t('approve')}</option>
            <option value="rejected">{t('reject')}</option>
          </select>
          {state.fieldErrors?.decision && (
            <span id={`${formId}-decision-error`} className="text-sm text-destructive">
              {state.fieldErrors.decision}
            </span>
          )}
        </label>
      )}
      <label className="grid gap-1">
        <span id={`${formId}-reason-label`}>{t('decisionReason')}</span>
        <textarea
          name="reason"
          aria-labelledby={`${formId}-reason-label`}
          aria-invalid={state.fieldErrors?.reason ? true : undefined}
          aria-describedby={state.fieldErrors?.reason ? `${formId}-reason-error` : undefined}
          required
          maxLength={2000}
          defaultValue={state.values?.reason ?? ''}
          className="rounded-md border bg-background p-2 aria-invalid:border-destructive"
        />
        {state.fieldErrors?.reason && (
          <span id={`${formId}-reason-error`} className="text-sm text-destructive">
            {state.fieldErrors.reason}
          </span>
        )}
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
