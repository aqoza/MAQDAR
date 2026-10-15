'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { enqueuePreparedForecast } from '@/app/(app)/forecasts/prepared/actions'
import { idleState } from '@/lib/forms'

export function PreparedForecastForm({
  organizationId,
  preparationId,
  requestId,
}: {
  organizationId: string
  preparationId: string
  requestId: string
}) {
  const t = useTranslations('PreparedForecast')
  const [state, action, pending] = useActionState(enqueuePreparedForecast, idleState)
  return (
    <form action={action} className="space-y-4 rounded-xl border p-4">
      <h2 className="text-xl font-semibold">{t('title')}</h2>
      <p className="text-sm">{t('description')}</p>
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="preparation_id" value={preparationId} />
      <input type="hidden" name="request_id" value={requestId} />
      <label className="grid gap-1 text-sm">
        {t('horizon')}
        <input
          name="horizon"
          type="number"
          min={1}
          max={90}
          required
          defaultValue={state.values?.horizon ?? '28'}
          className="w-32 rounded-md border bg-background p-2"
        />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input name="fixed_group_confirmed" type="checkbox" required className="mt-1" />
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
