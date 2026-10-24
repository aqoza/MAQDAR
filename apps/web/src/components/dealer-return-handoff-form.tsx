'use client'
import { useActionState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { idleState } from '@/lib/forms'
import { createReturnHandoff } from '@/app/(app)/replenishment/returns/handoffs/actions'

export function DealerReturnHandoffForm({
  organizationId,
  returnId,
}: {
  organizationId: string
  returnId: string
}) {
  const t = useTranslations('DealerReturnHandoffs')
  const [state, action, pending] = useActionState(createReturnHandoff, idleState)
  const error = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (state.status === 'error') error.current?.focus()
  }, [state])
  return (
    <form action={action} aria-label={t('create')} className="space-y-3 workspace-panel">
      <h2 className="text-section-title">{t('create')}</h2>
      <p>{t('createNote')}</p>
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="return_id" value={returnId} />
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
