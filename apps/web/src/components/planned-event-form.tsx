'use client'

import { useActionState, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  previewEvent,
  saveEvent,
  type EventPreviewState,
} from '@/app/(app)/forecasts/events/actions'
import { idleState } from '@/lib/forms'
import { eventInputSchema, eventTypes, type EventSource } from '@/lib/planned-events'
import { PlannedEventReport } from './planned-event-report'
import { TableScrollRegion } from './table-scroll-region'

export function PlannedEventForm({
  organizationId,
  source,
  requestId,
}: {
  organizationId: string
  source: EventSource
  requestId: string
}) {
  const t = useTranslations('PlannedEvents')
  const [state, action, pending] = useActionState(previewEvent, idleState as EventPreviewState)
  const [saved, save, saving] = useActionState(saveEvent, idleState)
  const [type, setType] = useState<string>('campaign')
  const [name, setName] = useState('')
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [additions, setAdditions] = useState(
    source.evidence.output.forecast.map((day) => ({ date: day.date, quantity: '0' })),
  )
  const current = eventInputSchema.safeParse({
    forecast_id: source.forecast_id,
    event_type: type,
    name,
    reason,
    unit: source.unit,
    confirmed,
    additions,
  })
  const report =
    current.success && JSON.stringify(current.data) === JSON.stringify(state.input)
      ? state.report
      : undefined
  const hidden = {
    organization_id: organizationId,
    forecast_id: source.forecast_id,
    unit: source.unit ?? '',
    additions: JSON.stringify(additions),
    confirmed: String(confirmed),
  }
  return (
    <div className="space-y-4">
      {/* A preview must retain inputs; native action resets can visually clear the checkbox. */}
      <form
        action={action}
        onReset={(event) => event.preventDefault()}
        className="space-y-3 workspace-panel"
        aria-label={t('entry')}
      >
        {Object.entries(hidden).map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="min-w-0 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <label className="grid min-w-0 gap-1">
                {t('eventType')}
                <select
                  name="event_type"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2"
                >
                  {eventTypes.map((value) => (
                    <option key={value} value={value}>
                      {t(`types.${value}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid min-w-0 gap-1">
                {t('name')}
                <input
                  required
                  maxLength={200}
                  name="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2"
                />
              </label>
            </div>
            <label className="grid gap-1">
              {t('reason')}
              <textarea
                required
                maxLength={2000}
                name="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                className="w-full rounded-md border bg-background px-3 py-2"
              />
            </label>
          </div>
          <div className="min-w-0 space-y-3">
            <p className="text-sm text-muted-foreground">
              {t('entryNote', { unit: source.unit ?? '' })}
            </p>
            <TableScrollRegion label={t('dailyEntry')} className="max-h-96">
              <table className="w-full text-sm">
                <caption className="sr-only">{t('dailyEntry')}</caption>
                <thead>
                  <tr>
                    {(['date', 'baseline', 'addition'] as const).map((key) => (
                      <th key={key} className="p-2 text-start">
                        {t(key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {additions.map((day, i) => (
                    <tr key={day.date} className="border-t">
                      <td className="whitespace-nowrap p-2">
                        <bdi>{day.date}</bdi>
                      </td>
                      <td className="p-2 tabular-nums">
                        <bdi>{source.evidence.output.forecast[i].quantity}</bdi>
                      </td>
                      <td className="p-2">
                        <input
                          aria-label={t('additionOn', { date: day.date })}
                          required
                          inputMode="decimal"
                          maxLength={40}
                          value={day.quantity}
                          onChange={(e) =>
                            setAdditions((rows) =>
                              rows.map((row, n) =>
                                n === i ? { ...row, quantity: e.target.value } : row,
                              ),
                            )
                          }
                          className="w-32 max-w-full rounded-md border bg-background px-3 py-2"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScrollRegion>
          </div>
        </div>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-1"
          />
          {t('confirmation')}
        </label>
        <button
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
        >
          {t(pending ? 'previewing' : 'preview')}
        </button>
        {state.message && <p role="alert">{state.message}</p>}
      </form>
      {report && (
        <>
          <PlannedEventReport report={report} />
          {!confirmed ? (
            <p role="status">{t('confirmToSave')}</p>
          ) : (
            <form action={save} className="space-y-3" aria-label={t('save')}>
              {Object.entries({
                ...hidden,
                event_type: type,
                name,
                reason,
                request_id: requestId,
                fingerprint: report.fingerprint,
              }).map(([key, value]) => (
                <input key={key} type="hidden" name={key} value={value} />
              ))}
              <button
                disabled={saving}
                className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
              >
                {t(saving ? 'saving' : 'save')}
              </button>
              {saved.message && <p role="alert">{saved.message}</p>}
            </form>
          )}
        </>
      )}
    </div>
  )
}
