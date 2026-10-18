'use client'

import { useActionState, useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  previewEventDelivery,
  saveEventDelivery,
  type EventDeliveryPreviewState,
} from '@/app/(app)/replenishment/events/deliveries/actions'
import { idleState } from '@/lib/forms'
import { isSaveableDelivery } from '@/lib/event-deliveries'
import { EventDeliveryReport } from './event-delivery-report'

export function EventDeliveryForm({
  organizationId,
  scenarioId,
  requestId,
  cutoff,
}: {
  organizationId: string
  scenarioId: string
  requestId: string
  cutoff: string
}) {
  const t = useTranslations('EventDeliveries')
  const id = useId()
  const [requested, setRequested] = useState(cutoff)
  const [confirmed, setConfirmed] = useState(false)
  const [state, preview, pending] = useActionState(
    previewEventDelivery,
    idleState as EventDeliveryPreviewState,
  )
  const [saved, save, saving] = useActionState(saveEventDelivery, idleState)
  const report =
    state.input?.scenario_id === scenarioId &&
    state.input?.requested_date === requested &&
    state.input?.calendars_confirmed === confirmed
      ? state.report
      : undefined
  const hidden = { organization_id: organizationId, scenario_id: scenarioId }
  const button = 'rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50'
  return (
    <div className="space-y-4">
      <form
        action={preview}
        onReset={(event) => event.preventDefault()}
        className="space-y-3 workspace-panel"
        aria-label={t('entry')}
      >
        {Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <div className="grid max-w-sm gap-1">
          <label htmlFor={id}>{t('requested')}</label>
          <input
            id={id}
            type="date"
            name="requested_date"
            required
            min={cutoff}
            max="2100-12-31"
            value={requested}
            onChange={(event) => setRequested(event.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2"
          />
        </div>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            name="calendars_confirmed"
            value="true"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-1 shrink-0"
          />
          <span>{t('confirmation')}</span>
        </label>
        <button disabled={pending} className={button}>
          {t(pending ? 'previewing' : 'preview')}
        </button>
        {state.message && <p role="alert">{state.message}</p>}
      </form>
      {report && (
        <>
          <EventDeliveryReport report={report} />
          {isSaveableDelivery(report.status) && (
            <form action={save} className="space-y-3" aria-label={t('save')}>
              {Object.entries({
                ...hidden,
                requested_date: report.input.requested_date,
                calendars_confirmed: String(confirmed),
                request_id: requestId,
                fingerprint: report.fingerprint,
              }).map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
              <button disabled={saving} className={button}>
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
