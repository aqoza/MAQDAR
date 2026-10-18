'use client'

import { useActionState, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  previewEventCost,
  saveEventCost,
  type EventCostPreviewState,
} from '@/app/(app)/replenishment/events/costs/actions'
import { idleState } from '@/lib/forms'
import { isSaveableEventCost } from '@/lib/event-costs'
import { EventCostReport } from './event-cost-report'

export function EventCostForm({
  organizationId,
  deliveryId,
  requestId,
}: {
  organizationId: string
  deliveryId: string
  requestId: string
}) {
  const t = useTranslations('EventCosts')
  const [confirmed, setConfirmed] = useState(false)
  const [state, preview, pending] = useActionState(
    previewEventCost,
    idleState as EventCostPreviewState,
  )
  const [saved, save, saving] = useActionState(saveEventCost, idleState)
  const report =
    state.input?.delivery_id === deliveryId && state.input?.price_confirmed === confirmed
      ? state.report
      : undefined
  const hidden = { organization_id: organizationId, delivery_id: deliveryId }
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
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            name="price_confirmed"
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
          <EventCostReport report={report} />
          {isSaveableEventCost(report.status) && (
            <form action={save} className="space-y-3" aria-label={t('save')}>
              {Object.entries({
                ...hidden,
                price_confirmed: String(confirmed),
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
