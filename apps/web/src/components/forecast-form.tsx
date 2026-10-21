'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { enqueueForecast } from '@/app/(app)/forecasts/new/actions'
import { idleState } from '@/lib/forms'
import { LocationCodeInput } from '@/components/master-data/location-code-input'

export function ForecastForm({
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
  const t = useTranslations('Forecasting')
  const [state, action, pending] = useActionState(enqueueForecast, idleState)
  const inputClass = 'w-full min-w-0 max-w-full rounded-md border bg-background p-2'
  return (
    <form action={action} className="space-y-4 workspace-panel">
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="request_id" value={requestId} />
      <label className="grid min-w-0 gap-1 text-sm">
        {t('methodLabel')}
        <select
          name="method"
          defaultValue={state.values?.method ?? 'expanded-v1'}
          className={inputClass}
        >
          <option value="expanded-v1">{t('expandedChoice')}</option>
          <option value="baseline-v1">{t('baselineChoice')}</option>
        </select>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid min-w-0 gap-1 text-sm">
          <label htmlFor="forecast-location">{t('location')}</label>
          <LocationCodeInput
            id="forecast-location"
            name="location_code"
            required
            defaultValue={state.values?.location_code ?? ''}
          />
        </div>
        <label className="grid min-w-0 gap-1 text-sm">
          {t('horizon')}
          <input
            name="horizon"
            type="number"
            required
            min={1}
            max={90}
            step={1}
            defaultValue={state.values?.horizon ?? '28'}
            className={inputClass}
          />
        </label>
        <label className="grid min-w-0 gap-1 text-sm">
          {t('from')}
          <input
            name="from_date"
            type="date"
            required
            defaultValue={state.values?.from_date ?? from}
            className={inputClass}
          />
        </label>
        <label className="grid min-w-0 gap-1 text-sm">
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
      <label className="grid min-w-0 gap-1 text-sm">
        {t('items')}
        <textarea
          name="item_codes"
          required
          maxLength={6500}
          rows={5}
          defaultValue={state.values?.item_codes ?? ''}
          className={inputClass}
        />
      </label>
      <p className="text-xs text-muted-foreground">{t('limits')}</p>
      <label className="flex items-start gap-2 text-sm">
        <input name="history_complete" type="checkbox" required className="mt-1" />
        {t('confirmation')}
      </label>
      <button
        disabled={pending}
        className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
      >
        {pending ? t('pending') : t('submit')}
      </button>
      {state.message && <p role="alert">{state.message}</p>}
    </form>
  )
}
