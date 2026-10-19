'use client'

import { useActionState, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { idleState } from '@/lib/forms'
import { enqueueConfigurations } from '@/app/(app)/forecasts/simulations/actions'

export function PolicyConfigurationsForm({
  organizationId,
  sourceRunId,
  requestId,
  alternative,
  lead,
  review,
}: {
  organizationId: string
  sourceRunId: string
  requestId: string
  alternative: string
  lead: number
  review: number
}) {
  const t = useTranslations('PolicyConfigurations')
  const [state, action, pending] = useActionState(enqueueConfigurations, idleState)
  const nextId = useRef(1)
  const [rows, setRows] = useState([
    { id: 0, maximum: alternative, lead_time: String(lead), review_interval: String(review) },
  ])
  const update = (id: number, key: 'maximum' | 'lead_time' | 'review_interval', value: string) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, [key]: value } : row)))
  return (
    <form action={action} aria-label={t('create')} className="workspace-panel space-y-4">
      <h2 className="text-section-title">{t('alternatives')}</h2>
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="source_run_id" value={sourceRunId} />
      <input type="hidden" name="request_id" value={requestId} />
      <input
        type="hidden"
        name="configurations"
        value={JSON.stringify(
          rows.map((row) => ({
            maximum: row.maximum,
            lead_time: row.lead_time === '' ? null : Number(row.lead_time),
            review_interval: row.review_interval === '' ? null : Number(row.review_interval),
          })),
        )}
      />
      <p className="text-xs text-muted-foreground">{t('inputHelp')}</p>
      <fieldset disabled={pending} className="min-w-0 space-y-3">
        <legend className="sr-only">{t('alternatives')}</legend>
        {rows.map((row, index) => (
          <fieldset
            key={row.id}
            className="grid min-w-0 gap-3 rounded-md border p-3 sm:grid-cols-3 xl:grid-cols-[1fr_1fr_1fr_auto]"
          >
            <legend className="px-1 font-medium">{t('alternative', { number: index + 1 })}</legend>
            <label className="grid min-w-0 gap-1">
              {t('maximum')}
              <input
                required
                type="text"
                inputMode="decimal"
                pattern="[0-9]{1,15}(\.[0-9]{1,3})?"
                maxLength={19}
                value={row.maximum}
                onChange={(event) => update(row.id, 'maximum', event.target.value)}
                className="min-h-11 w-full min-w-0 rounded-md border bg-background p-2"
              />
            </label>
            <label className="grid min-w-0 gap-1">
              {t('lead')}
              <input
                required
                type="number"
                min={0}
                max={365}
                step={1}
                value={row.lead_time}
                onChange={(event) => update(row.id, 'lead_time', event.target.value)}
                className="min-h-11 w-full min-w-0 rounded-md border bg-background p-2"
              />
            </label>
            <label className="grid min-w-0 gap-1">
              {t('review')}
              <input
                required
                type="number"
                min={1}
                max={365}
                step={1}
                value={row.review_interval}
                onChange={(event) => update(row.id, 'review_interval', event.target.value)}
                className="min-h-11 w-full min-w-0 rounded-md border bg-background p-2"
              />
            </label>
            <button
              type="button"
              disabled={rows.length === 1}
              onClick={() => setRows((current) => current.filter((value) => value.id !== row.id))}
              aria-label={t('remove', { number: index + 1 })}
              className="min-h-11 self-end rounded-md border px-3 py-2 disabled:opacity-50"
            >
              {t('removeShort')}
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          disabled={rows.length >= 10}
          onClick={() => {
            const id = nextId.current++
            setRows((current) => [
              ...current,
              { id, maximum: '', lead_time: String(lead), review_interval: String(review) },
            ])
          }}
          className="min-h-11 rounded-md border px-3 py-2 disabled:opacity-50"
        >
          {t('add')}
        </button>
        <label className="flex min-h-11 items-start gap-3">
          <input
            type="checkbox"
            name="reuse_confirmed"
            required
            defaultChecked={state.values?.reuse_confirmed === 'on'}
            className="mt-1 size-5 shrink-0"
          />
          <span>{t('reuse')}</span>
        </label>
        <button className="min-h-11 rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">
          {t(pending ? 'pending' : 'submit')}
        </button>
      </fieldset>
      {state.message && <p role="alert">{state.message}</p>}
    </form>
  )
}
