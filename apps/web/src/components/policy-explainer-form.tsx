'use client'
import { useActionState, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  explainPolicy,
  explainForecast,
  explainReplenishment,
  configurePolicyExplainer,
} from '@/app/(app)/forecasts/explanations/actions'
import { idleState } from '@/lib/forms'
const button =
  'min-h-11 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50'
export function PolicyExplainerForm({
  organizationId,
  sourceId,
  fingerprint,
  requestId,
  kind = 'policy',
}: {
  organizationId: string
  sourceId: string
  fingerprint: string
  requestId: string
  kind?: 'policy' | 'forecast' | 'replenishment'
}) {
  const t = useTranslations('PolicyExplainer')
  const [state, action, pending] = useActionState(
    { policy: explainPolicy, forecast: explainForecast, replenishment: explainReplenishment }[kind],
    idleState,
  )
  const [question, setQuestion] = useState('')
  return (
    <form action={action} aria-busy={pending} className="space-y-4 workspace-panel">
      <input type="hidden" name="organization_id" value={organizationId} />
      <input
        type="hidden"
        name={{ policy: 'policy_id', forecast: 'forecast_id', replenishment: 'draft_id' }[kind]}
        value={sourceId}
      />
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="fingerprint" value={fingerprint} />
      <label className="grid gap-2">
        {t('question')}
        <textarea
          name="question"
          required
          maxLength={2000}
          rows={4}
          disabled={pending}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          aria-describedby="question-help"
          className="w-full min-w-0 rounded-md border bg-background px-3 py-2 text-base md:text-sm"
        />
      </label>
      <p id="question-help" className="text-xs text-muted-foreground">
        {t('questionHelp')}
      </p>
      <label className="flex min-h-11 items-start gap-2">
        <input type="checkbox" name="confirmed" required disabled={pending} className="mt-1" />
        <span>{t('confirm')}</span>
      </label>
      {state.status === 'error' && (
        <p role="alert" className="text-destructive">
          {state.message}
        </p>
      )}
      <button disabled={pending} className={button}>
        {t(pending ? 'working' : 'generate')}
      </button>
    </form>
  )
}
export function PolicyExplainerSettingsForm({
  organizationId,
  enabled,
  configured,
}: {
  organizationId: string
  enabled: boolean
  configured: boolean
}) {
  const t = useTranslations('PolicyExplainer')
  const [state, action, pending] = useActionState(configurePolicyExplainer, idleState)
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="organization_id" value={organizationId} />
      <p>{t('settingsDescription')}</p>
      {!configured && <p role="status">{t('unconfigured')}</p>}
      <label className="flex min-h-11 items-start gap-2">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={enabled}
          disabled={pending || (!configured && !enabled)}
          className="mt-1"
        />
        <span>{t('optIn')}</span>
      </label>
      <p className="text-xs text-muted-foreground">{t('quotas')}</p>
      {state.status !== 'idle' && (
        <p role={state.status === 'error' ? 'alert' : 'status'}>{state.message}</p>
      )}
      <button disabled={pending || (!configured && !enabled)} className={button}>
        {t('saveSetting')}
      </button>
    </form>
  )
}
