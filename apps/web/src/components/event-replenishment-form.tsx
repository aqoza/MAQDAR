'use client'

import { useActionState, useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  previewEventDraft,
  saveEventDraft,
  type EventDraftPreviewState,
} from '@/app/(app)/replenishment/events/actions'
import { idleState } from '@/lib/forms'
import { eventQuantitySchema } from '@/lib/planned-events'
import { EventReplenishmentReport } from './event-replenishment-report'

export function EventReplenishmentForm({
  organizationId,
  scenarioId,
  requestId,
}: {
  organizationId: string
  scenarioId: string
  requestId: string
}) {
  const t = useTranslations('EventReplenishment')
  const id = useId()
  const [backorders, setBackorders] = useState('')
  const [ordersConfirmed, setOrdersConfirmed] = useState(false)
  const [eventUncommitted, setEventUncommitted] = useState(false)
  const [state, preview, pending] = useActionState(
    previewEventDraft,
    idleState as EventDraftPreviewState,
  )
  const [saved, save, saving] = useActionState(saveEventDraft, idleState)
  const quantity = eventQuantitySchema.safeParse(backorders)
  const report =
    quantity.success &&
    state.input?.backorders === quantity.data &&
    state.input?.scenario_id === scenarioId &&
    state.input?.orders_confirmed === ordersConfirmed &&
    state.input?.event_uncommitted === eventUncommitted
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
          <label htmlFor={id}>{t('backorders')}</label>
          <input
            id={id}
            name="backorders"
            required
            inputMode="decimal"
            maxLength={40}
            value={backorders}
            onChange={(event) => setBackorders(event.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2"
          />
        </div>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            name="orders_confirmed"
            value="true"
            checked={ordersConfirmed}
            onChange={(event) => setOrdersConfirmed(event.target.checked)}
            className="mt-1 shrink-0"
          />
          <span>{t('confirmOrders')}</span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            name="event_uncommitted"
            value="true"
            checked={eventUncommitted}
            onChange={(event) => setEventUncommitted(event.target.checked)}
            className="mt-1 shrink-0"
          />
          <span>{t('confirmEvent')}</span>
        </label>
        <button disabled={pending} className={button}>
          {t(pending ? 'previewing' : 'preview')}
        </button>
        {state.message && <p role="alert">{state.message}</p>}
      </form>
      {report && (
        <>
          <EventReplenishmentReport report={report} />
          <form action={save} className="space-y-3" aria-label={t('save')}>
            {Object.entries({
              ...hidden,
              backorders: report.input.backorders,
              orders_confirmed: String(ordersConfirmed),
              event_uncommitted: String(eventUncommitted),
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
        </>
      )}
    </div>
  )
}
