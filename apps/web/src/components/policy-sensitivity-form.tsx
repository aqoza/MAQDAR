'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { idleState } from '@/lib/forms'
import { enqueueSensitivity } from '@/app/(app)/forecasts/simulations/actions'

export function PolicySensitivityForm({
  organizationId,
  sourceRunId,
  requestId,
  alternative,
}: {
  organizationId: string
  sourceRunId: string
  requestId: string
  alternative: string
}) {
  const t = useTranslations('PolicySensitivity')
  const [state, action, pending] = useActionState(enqueueSensitivity, idleState)
  return (
    <form action={action} aria-label={t('create')} className="workspace-panel space-y-4">
      <h2 className="text-section-title">{t('alternatives')}</h2>
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="source_run_id" value={sourceRunId} />
      <input type="hidden" name="request_id" value={requestId} />
      <label className="grid min-w-0 gap-1">
        {t('maxima')}
        <textarea
          name="maxima"
          required
          maxLength={220}
          rows={3}
          defaultValue={state.values?.maxima ?? alternative}
          aria-describedby="maxima-help"
          className="w-full min-w-0 rounded-md border bg-background p-2"
        />
      </label>
      <p id="maxima-help" className="text-xs text-muted-foreground">
        {t('inputHelp')}
      </p>
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
      <button
        disabled={pending}
        className="min-h-11 rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
      >
        {t(pending ? 'pending' : 'submit')}
      </button>
      {state.message && <p role="alert">{state.message}</p>}
    </form>
  )
}
