'use client'

import { useActionState, useState } from 'react'
import { useTranslations } from 'next-intl'
import { enqueueMultiDriverForecast } from '@/app/(app)/forecasts/drivers/forecast-actions'
import { idleState } from '@/lib/forms'

export function MultiDriverForecastForm({
  organizationId,
  datasetId,
  datasets,
  requestId,
  forecasts,
}: {
  organizationId: string
  datasetId: string
  datasets: { id: string; label: string; metadata: string }[]
  requestId: string
  forecasts: { id: string; label: string }[]
}) {
  const t = useTranslations('MultiDriverForecast')
  const [state, action, pending] = useActionState(enqueueMultiDriverForecast, idleState)
  const [selected, setSelected] = useState<string[]>([])
  return (
    <form action={action} className="workspace-panel space-y-4">
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="dataset_id" value={datasetId} />
      <input type="hidden" name="request_id" value={requestId} />
      <fieldset
        disabled={pending || !forecasts.length || !datasets.length}
        className="min-w-0 space-y-4"
      >
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
        <fieldset className="min-w-0 space-y-2">
          <legend className="font-medium text-sm">{t('datasets')}</legend>
          <p className="text-xs" id="driver-selection-help">
            {t('selectionHelp', { count: selected.length + 1 })}
          </p>
          {!datasets.length && <p className="text-sm">{t('noDatasets')}</p>}
          <div className="max-h-72 overflow-y-auto space-y-1">
            {datasets.map((d) => (
              <label
                key={d.id}
                className="flex min-h-11 items-center gap-2 rounded-md border p-2 text-sm break-words"
              >
                <input
                  type="checkbox"
                  name="dataset_id"
                  value={d.id}
                  checked={selected.includes(d.id)}
                  aria-describedby="driver-selection-help"
                  disabled={!selected.includes(d.id) && selected.length === 4}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? [...selected, d.id] : selected.filter((id) => id !== d.id),
                    )
                  }
                />
                <span className="grid min-w-0 gap-1">
                  <span className="break-words">{d.label}</span>
                  <bdi className="break-all text-xs text-muted-foreground">{d.metadata}</bdi>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex min-h-11 items-start gap-2 text-sm">
          <input name="confirmed" type="checkbox" required className="mt-1" />
          {t('confirmation')}
        </label>
        <button
          disabled={selected.length < 1}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
        >
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
