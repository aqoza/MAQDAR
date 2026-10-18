'use client'

import { useActionState, useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  previewEventPolicy,
  saveEventPolicy,
  type EventPolicyPreviewState,
} from '@/app/(app)/forecasts/events/policies/actions'
import { idleState } from '@/lib/forms'
import { EventPolicyReport } from './event-policy-report'

export function EventPolicyForm({
  organizationId,
  eventId,
  policyId,
  requestId,
}: {
  organizationId: string
  eventId: string
  policyId: string
  requestId: string
}) {
  const t = useTranslations('EventPolicies')
  const reasonId = useId()
  const [reason, setReason] = useState('')
  const [state, action, pending] = useActionState(
    previewEventPolicy,
    idleState as EventPolicyPreviewState,
  )
  const [saved, save, saving] = useActionState(saveEventPolicy, idleState)
  const report =
    state.input?.reason === reason.trim() &&
    state.input?.policy_id === policyId &&
    state.input?.event_id === eventId
      ? state.report
      : undefined
  const hidden = { organization_id: organizationId, event_id: eventId, policy_id: policyId }
  return (
    <div className="space-y-4">
      <form
        action={action}
        onReset={(event) => event.preventDefault()}
        className="space-y-3 workspace-panel"
        aria-label={t('entry')}
      >
        {Object.entries(hidden).map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
        <div className="grid gap-1">
          <label htmlFor={reasonId}>{t('reason')}</label>
          <textarea
            id={reasonId}
            required
            name="reason"
            maxLength={2000}
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2"
          />
        </div>
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
          <EventPolicyReport report={report} />
          <form action={save} className="space-y-3" aria-label={t('save')}>
            {Object.entries({
              ...hidden,
              reason: reason.trim(),
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
        </>
      )}
    </div>
  )
}
