'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { enqueueRun, cancelRun } from '@/app/(app)/forecasts/actions'
import { idleState } from '@/lib/forms'

type Labels = { location: string; from: string; to: string; submit: string; pending: string }

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
    <form action={action} className="flex flex-wrap items-end gap-4 rounded-xl border p-4">
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="request_id" value={requestId} />
      <label className="grid gap-1 text-sm">
        {labels.location}
        <input
          name="location_code"
          required
          maxLength={64}
          defaultValue={state.values?.location_code ?? ''}
          className="rounded-md border bg-background p-2"
        />
      </label>
      <label className="grid gap-1 text-sm">
        {labels.from}
        <input
          name="from_date"
          type="date"
          required
          defaultValue={state.values?.from_date ?? from}
          className="rounded-md border bg-background p-2"
        />
      </label>
      <label className="grid gap-1 text-sm">
        {labels.to}
        <input
          name="to_date"
          type="date"
          required
          defaultValue={state.values?.to_date ?? to}
          className="rounded-md border bg-background p-2"
        />
      </label>
      <button
        disabled={pending}
        className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
      >
        {pending ? labels.pending : labels.submit}
      </button>
      {state.message && (
        <p role="alert" className="w-full text-sm">
          {state.message}
        </p>
      )}
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

export function PlanningRefresh({ active, label }: { active: boolean; label: string }) {
  const router = useRouter()
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh()
    }, 5000)
    return () => clearInterval(timer)
  }, [active, router])
  return (
    <button className="text-sm underline" onClick={() => router.refresh()}>
      {label}
    </button>
  )
}
