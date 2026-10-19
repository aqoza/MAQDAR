'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { idleState } from '@/lib/forms'
import { enqueueSimulation } from '@/app/(app)/forecasts/simulations/actions'

export function PolicySimulationForm({
  organizationId,
  policyId,
  requestId,
  first,
  last,
}: {
  organizationId: string
  policyId: string
  requestId: string
  first: string
  last: string
}) {
  const t = useTranslations('PolicySimulation')
  const [state, action, pending] = useActionState(enqueueSimulation, idleState)
  return (
    <form action={action} aria-label={t('create')} className="workspace-panel space-y-4">
      <h2 className="text-section-title">{t('create')}</h2>
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="policy_id" value={policyId} />
      <input type="hidden" name="request_id" value={requestId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid min-w-0 gap-1">
          {t('toDate')}
          <input
            name="to_date"
            type="date"
            min={first}
            max={last}
            required
            defaultValue={state.values?.to_date ?? last}
            className="w-full min-w-0 rounded-md border bg-background p-2"
          />
        </label>
        {(['opening_stock', 'alternative_maximum'] as const).map((key) => (
          <label key={key} className="grid min-w-0 gap-1">
            {t(key)}
            <input
              name={key}
              type="text"
              inputMode="decimal"
              required
              maxLength={19}
              pattern="[0-9]{1,15}(\.[0-9]{1,3})?"
              defaultValue={state.values?.[key] ?? ''}
              className="w-full min-w-0 rounded-md border bg-background p-2"
            />
          </label>
        ))}
      </div>
      {(['history_confirmed', 'empty_start_confirmed'] as const).map((key) => (
        <label className="flex min-h-11 items-start gap-3" key={key}>
          <input
            type="checkbox"
            name={key}
            required
            className="mt-1 size-5 shrink-0"
            defaultChecked={state.values?.[key] === 'on'}
          />
          <span>{t(key)}</span>
        </label>
      ))}
      <button
        disabled={pending}
        className="min-h-11 rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
      >
        {t(pending ? 'pending' : 'submit')}
      </button>
      {state.message && <p role="alert">{state.message}</p>}
    </form>
  )
}
