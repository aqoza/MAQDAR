'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { idleState } from '@/lib/forms'
import { enqueuePolicy } from '@/app/(app)/forecasts/policies/actions'

export function InventoryPolicyForm({
  organizationId,
  forecastId,
  requestId,
  horizon,
}: {
  organizationId: string
  forecastId: string
  requestId: string
  horizon: number
}) {
  const t = useTranslations('InventoryPolicy')
  const [state, action, pending] = useActionState(enqueuePolicy, idleState)
  return (
    <form action={action} className="space-y-4 rounded-xl border p-4">
      <h2 className="text-xl font-semibold">{t('create')}</h2>
      <p>{t('formNote', { horizon })}</p>
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="forecast_id" value={forecastId} />
      <input type="hidden" name="request_id" value={requestId} />
      <div className="flex flex-wrap gap-4">
        {(
          [
            ['lead_time', 'leadTime', 0, 89, 1, ''],
            ['review_interval', 'reviewInterval', 1, 90, 1, '7'],
            ['service_percent', 'serviceTarget', 50, 99.9, 0.1, '95'],
          ] as const
        ).map(([name, label, min, max, step, value]) => (
          <label className="grid gap-1 text-sm" key={name}>
            {t(label)}
            <input
              name={name}
              type="number"
              required
              min={min}
              max={max}
              step={step}
              defaultValue={state.values?.[name] ?? value}
              className="w-40 rounded-md border bg-background p-2"
            />
          </label>
        ))}
      </div>
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
