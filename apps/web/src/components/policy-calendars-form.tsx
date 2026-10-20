'use client'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { enqueueCalendars } from '@/app/(app)/forecasts/simulations/actions'
import { idleState } from '@/lib/forms'

export function PolicyCalendarsForm({
  organizationId,
  source,
  calendar,
  fingerprint,
  requestId,
}: {
  organizationId: string
  source: string
  calendar: string
  fingerprint: string
  requestId: string
}) {
  const t = useTranslations('PolicyCalendars')
  const [state, action, pending] = useActionState(enqueueCalendars, idleState)
  return (
    <form action={action} aria-label={t('queue')} className="workspace-panel space-y-3">
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="source" value={source} />
      <input type="hidden" name="calendar" value={calendar} />
      <input type="hidden" name="fingerprint" value={fingerprint} />
      <input type="hidden" name="request_id" value={requestId} />
      <label className="flex min-h-11 items-start gap-2">
        <input type="checkbox" name="confirmed" required className="mt-1 size-4 shrink-0" />
        <span>{t('confirmation')}</span>
      </label>
      {state.status === 'error' && (
        <p role="alert">{state.code === 'MQ409' ? t('changed') : state.message}</p>
      )}
      <button
        disabled={pending}
        className="min-h-11 rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
      >
        {pending ? t('pending') : t('queue')}
      </button>
    </form>
  )
}
