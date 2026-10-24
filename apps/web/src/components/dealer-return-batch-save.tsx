'use client'
import { useActionState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { idleState } from '@/lib/forms'
import { createReturnBatch } from '@/app/(app)/replenishment/returns/batches/actions'

export function DealerReturnBatchSave({
  organizationId,
  handoffIds,
}: {
  organizationId: string
  handoffIds: string[]
}) {
  const t = useTranslations('DealerReturnBatches')
  const [state, action, pending] = useActionState(createReturnBatch, idleState)
  const error = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (state.status === 'error') error.current?.focus()
  }, [state])
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="organization_id" value={organizationId} />
      {handoffIds.map((id) => (
        <input key={id} type="hidden" name="handoff" value={id} />
      ))}
      {state.message && (
        <p ref={error} tabIndex={-1} role="alert">
          {state.message}
        </p>
      )}
      <button
        disabled={pending}
        className="min-h-11 rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
      >
        {t(pending ? 'saving' : 'save')}
      </button>
    </form>
  )
}
