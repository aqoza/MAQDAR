'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { enqueueDriverForecast } from '@/app/(app)/forecasts/drivers/forecast-actions'
import { idleState } from '@/lib/forms'

export function DriverForecastForm({
  organizationId,
  datasetId,
  requestId,
  forecasts,
}: {
  organizationId: string
  datasetId: string
  requestId: string
  forecasts: { id: string; label: string }[]
}) {
  const t = useTranslations('DriverForecast')
  const [state, action, pending] = useActionState(enqueueDriverForecast, idleState)
  return (
    <form action={action} className="workspace-panel space-y-4">
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="dataset_id" value={datasetId} />
      <input type="hidden" name="request_id" value={requestId} />
      <fieldset disabled={pending || !forecasts.length} className="min-w-0 space-y-4">
        <label className="grid gap-1 text-sm">
          {t('sourceForecast')}
          <select
            name="forecast_id"
            required
            className="w-full min-w-0 rounded-md border bg-background p-2"
          >
            <option value="">{t('choose')}</option>
            {forecasts.map((f) => (
              <option value={f.id} key={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        {!forecasts.length && <p className="text-sm">{t('noMatches')}</p>}
        <label className="flex min-h-11 items-start gap-2 text-sm">
          <input name="confirmed" type="checkbox" required className="mt-1" />
          {t('confirmation')}
        </label>
        <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">
          {t(pending ? 'pending' : 'submit')}
        </button>
      </fieldset>
      {state.message && (
        <p role="alert" className="text-sm">
          {state.message}
        </p>
      )}
    </form>
  )
}
