'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { enqueuePreparation } from '@/app/(app)/forecasts/prepare/actions'
import { idleState } from '@/lib/forms'

export function PreparationForm({
  organizationId,
  requestId,
  from,
  to,
}: {
  organizationId: string
  requestId: string
  from: string
  to: string
}) {
  const t = useTranslations('Preparation')
  const [state, action, pending] = useActionState(enqueuePreparation, idleState)
  const inputClass = 'rounded-md border bg-background p-2'
  return (
    <form action={action} className="space-y-4 workspace-panel">
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="request_id" value={requestId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          {t('location')}
          <input
            name="location_code"
            required
            maxLength={64}
            defaultValue={state.values?.location_code ?? ''}
            className={inputClass}
          />
        </label>
        <label className="grid gap-1 text-sm">
          {t('from')}
          <input
            name="from_date"
            type="date"
            required
            defaultValue={state.values?.from_date ?? from}
            className={inputClass}
          />
        </label>
        <label className="grid gap-1 text-sm">
          {t('to')}
          <input
            name="to_date"
            type="date"
            required
            defaultValue={state.values?.to_date ?? to}
            className={inputClass}
          />
        </label>
      </div>
      <label className="grid gap-1 text-sm">
        {t('items')}
        <textarea
          name="item_codes"
          required
          maxLength={1625}
          rows={5}
          defaultValue={state.values?.item_codes ?? ''}
          className={inputClass}
        />
      </label>
      <p className="text-sm text-muted-foreground">{t('limits')}</p>
      <p className="text-sm">{t('rules')}</p>
      <label className="flex items-start gap-2 text-sm">
        <input name="history_complete" type="checkbox" required className="mt-1" />
        {t('confirmation')}
      </label>
      <button
        disabled={pending}
        className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
      >
        {t(pending ? 'pending' : 'submit')}
      </button>
      {state.message && <p role="alert">{state.message}</p>}
    </form>
  )
}
