'use client'
import { useActionState, useState } from 'react'
import { useTranslations } from 'next-intl'
import { reviewDealerReturn } from '@/app/(app)/replenishment/returns/actions'
import { idleState } from '@/lib/forms'

export function DealerReturnReview({
  organizationId,
  returnId,
}: {
  organizationId: string
  returnId: string
}) {
  const t = useTranslations('DealerReturns')
  const [state, action, pending] = useActionState(reviewDealerReturn, idleState)
  const [decision, setDecision] = useState('')
  const [edited, setEdited] = useState<string[]>([])
  const error = (name: string) => (edited.includes(name) ? undefined : state.fieldErrors?.[name])
  const field = 'w-full min-w-0 rounded-md border bg-background px-3 py-2'
  return (
    <form
      action={action}
      className="space-y-3 workspace-panel"
      onSubmit={() => setEdited([])}
      onChange={(event) => {
        const target = event.target
        if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement)
          setEdited((previous) => [...new Set([...previous, target.name])])
      }}
    >
      <h2 className="text-section-title">{t('review')}</h2>
      <p className="text-xs text-muted-foreground">{t('reviewLimits')}</p>
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="return_id" value={returnId} />
      <fieldset disabled={pending} className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="grid content-start gap-1">
          <label htmlFor="return-review-decision">{t('decision')}</label>
          <select
            id="return-review-decision"
            name="decision"
            required
            value={decision}
            onChange={(event) => setDecision(event.target.value)}
            className={field}
            aria-invalid={Boolean(error('decision'))}
            aria-describedby={error('decision') ? 'decision-error' : undefined}
          >
            <option value="">{t('choose')}</option>
            <option value="approved">{t('approve')}</option>
            <option value="rejected">{t('reject')}</option>
          </select>
          {error('decision') && (
            <span id="decision-error" className="text-destructive">
              {error('decision')}
            </span>
          )}
        </div>
        <div className="grid content-start gap-1">
          <label htmlFor="return-review-reason">{t('decisionReason')}</label>
          <input
            id="return-review-reason"
            name="reason"
            required
            maxLength={1000}
            defaultValue={state.values?.reason ?? ''}
            className={field}
            aria-invalid={Boolean(error('reason'))}
            aria-describedby={error('reason') ? 'decision-reason-error' : undefined}
          />
          {error('reason') && (
            <span id="decision-reason-error" className="text-destructive">
              {error('reason')}
            </span>
          )}
        </div>
        {decision === 'approved' && (
          <label className="flex min-h-11 items-start gap-2 sm:col-span-2">
            <input
              type="checkbox"
              name="eligibility_confirmed"
              required
              className="mt-1"
              aria-invalid={Boolean(error('eligibility_confirmed'))}
              aria-describedby={error('eligibility_confirmed') ? 'eligibility-error' : undefined}
            />
            <span>{t('eligibilityConfirmation')}</span>
          </label>
        )}
        {error('eligibility_confirmed') && (
          <p id="eligibility-error" className="text-destructive sm:col-span-2">
            {error('eligibility_confirmed')}
          </p>
        )}
      </fieldset>
      {state.status === 'error' && (!state.fieldErrors || edited.length === 0) && (
        <p role="alert" className="text-destructive">
          {state.message}
        </p>
      )}
      <button
        disabled={pending}
        className="min-h-11 rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
      >
        {t(pending ? 'working' : 'recordDecision')}
      </button>
    </form>
  )
}
