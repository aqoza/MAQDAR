'use client'

import { startTransition, useActionState, useState, useSyncExternalStore } from 'react'
import { useTranslations } from 'next-intl'
import {
  previewInstalledEvaluation,
  saveInstalledEvaluation,
  type InstalledEvaluationPreviewState,
} from '@/app/(app)/forecasts/installed-base/evaluations/actions'
import { installedEvaluationInputSchema } from '@/lib/installed-base-evaluation'
import { idleState } from '@/lib/forms'
import { InstalledBaseEvaluationReport } from './installed-base-evaluation-report'

const subscribeHydration = () => () => {}
export function InstalledBaseEvaluationForm({
  organizationId,
  scenarioId,
  requestId,
}: {
  organizationId: string
  scenarioId: string
  requestId: string
}) {
  const t = useTranslations('InstalledBaseEvaluation')
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  )
  const [name, setName] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [state, preview, pending] = useActionState(
    previewInstalledEvaluation,
    idleState as InstalledEvaluationPreviewState,
  )
  const [saved, save, saving] = useActionState(saveInstalledEvaluation, idleState)
  const [submittedFingerprint, setSubmittedFingerprint] = useState<string>()
  const parsed = installedEvaluationInputSchema.safeParse({
    scenario_id: scenarioId,
    evaluation_name: name,
    confirmed,
  })
  const current =
    parsed.success && state.input && JSON.stringify(parsed.data) === JSON.stringify(state.input)
  const disabled = !hydrated || pending || saving
  return (
    <div className="min-w-0 space-y-4">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          // Keep the explicit confirmation checked; previewing must not reset form inputs.
          startTransition(() => preview(form))
        }}
        className="space-y-3 workspace-panel"
      >
        <input type="hidden" name="organization_id" value={organizationId} />
        <input
          type="hidden"
          name="input"
          value={JSON.stringify({ scenario_id: scenarioId, evaluation_name: name, confirmed })}
        />
        <label className="grid gap-1 text-sm">
          {t('evaluation_name')}
          <input
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={disabled}
            className="min-w-0 w-full rounded-md border bg-background px-3 py-2"
          />
        </label>
        <label className="flex min-h-11 items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            disabled={disabled}
            className="mt-1 shrink-0"
          />
          <span>{t('confirmation')}</span>
        </label>
        {state.status === 'error' && (
          <p role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
        )}
        <button
          disabled={disabled || !parsed.success}
          className="min-h-11 rounded-md bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50"
        >
          {pending ? t('working') : t('preview')}
        </button>
      </form>
      {current && state.report && (
        <>
          <InstalledBaseEvaluationReport report={state.report} />
          <form
            action={save}
            onSubmit={() => setSubmittedFingerprint(state.report!.fingerprint)}
            className="space-y-3 workspace-panel"
          >
            <input type="hidden" name="organization_id" value={organizationId} />
            <input type="hidden" name="input" value={JSON.stringify(parsed.data)} />
            <input type="hidden" name="request_id" value={requestId} />
            <input type="hidden" name="fingerprint" value={state.report.fingerprint} />
            {saved.status === 'error' && submittedFingerprint === state.report.fingerprint && (
              <p role="alert" className="text-sm text-destructive">
                {saved.message}
              </p>
            )}
            <button
              disabled={disabled}
              className="min-h-11 rounded-md bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50"
            >
              {saving ? t('working') : t('save')}
            </button>
          </form>
        </>
      )}
    </div>
  )
}
