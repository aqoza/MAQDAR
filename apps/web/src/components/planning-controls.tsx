'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Play, RotateCw } from 'lucide-react'
import { enqueueRun, cancelRun } from '@/app/(app)/forecasts/actions'
import { LocationCodeInput } from '@/components/master-data/location-code-input'
import { idleState } from '@/lib/forms'
import styles from '@/components/forecast-workspace.module.css'

type Labels = {
  location: string
  from: string
  to: string
  submit: string
  pending: string
  locationPlaceholder: string
}

export function PlanningForm({
  organizationId,
  requestId,
  from,
  to,
  labels,
}: {
  organizationId: string
  requestId: string
  from: string
  to: string
  labels: Labels
}) {
  const [state, action, pending] = useActionState(enqueueRun, idleState)
  return (
    <form
      action={action}
      id="demand-check"
      aria-label={labels.submit}
      tabIndex={-1}
      className={styles.readinessForm}
    >
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="request_id" value={requestId} />
      <div className={styles.toolbar}>
        <div className={`${styles.field} ${styles.locationField}`}>
          <label htmlFor="readiness-location">{labels.location}</label>
          <LocationCodeInput
            id="readiness-location"
            name="location_code"
            required
            defaultValue={state.values?.location_code ?? ''}
          />
        </div>
        <label className={styles.field}>
          {labels.from}
          <input
            name="from_date"
            type="date"
            required
            defaultValue={state.values?.from_date ?? from}
          />
        </label>
        <label className={styles.field}>
          {labels.to}
          <input name="to_date" type="date" required defaultValue={state.values?.to_date ?? to} />
        </label>
        <button disabled={pending} className={styles.primaryButton}>
          <Play aria-hidden="true" />
          {pending ? labels.pending : labels.submit}
        </button>
        {state.message && (
          <p role="alert" className={styles.feedback}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  )
}

export function CancelPlanningRun({
  organizationId,
  runId,
  label,
}: {
  organizationId: string
  runId: string
  label: string
}) {
  const [state, action, pending] = useActionState(cancelRun, idleState)
  return (
    <form action={action}>
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="run_id" value={runId} />
      <button
        disabled={pending}
        className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
      >
        {label}
      </button>
      {state.message && <p role="alert">{state.message}</p>}
    </form>
  )
}

export function PlanningRefresh({
  active,
  label,
  compact = false,
}: {
  active: boolean
  label: string
  compact?: boolean
}) {
  const router = useRouter()
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh()
    }, 5000)
    return () => clearInterval(timer)
  }, [active, router])
  return (
    <button
      className={styles.refresh}
      title={compact ? label : undefined}
      onClick={() => router.refresh()}
    >
      <RotateCw aria-hidden="true" />
      <span className={compact ? 'sr-only' : undefined}>{label}</span>
    </button>
  )
}
