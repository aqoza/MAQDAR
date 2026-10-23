'use client'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { idleState } from '@/lib/forms'
import { createBatch } from '@/app/(app)/replenishment/regional-stock/sourcing/batches/actions'

export function RegionalBatchSave({
  organizationId,
  handoffIds,
}: {
  organizationId: string
  handoffIds: string[]
}) {
  const t = useTranslations('RegionalBatches')
  const [state, action, pending] = useActionState(createBatch, idleState)
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="organization_id" value={organizationId} />
      {handoffIds.map((id) => (
        <input key={id} type="hidden" name="handoff" value={id} />
      ))}
      <button
        disabled={pending}
        className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
      >
        {t(pending ? 'saving' : 'save')}
      </button>
      {state.message && <p role="alert">{state.message}</p>}
    </form>
  )
}
