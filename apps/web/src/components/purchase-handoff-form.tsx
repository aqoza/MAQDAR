'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { idleState } from '@/lib/forms'
import { createHandoff } from '@/app/(app)/replenishment/handoffs/actions'

export function PurchaseHandoffForm({
  organizationId,
  proposalId,
}: {
  organizationId: string
  proposalId: string
}) {
  const t = useTranslations('PurchaseHandoffs')
  const [state, action, pending] = useActionState(createHandoff, idleState)
  return (
    <form action={action} aria-label={t('create')} className="space-y-3 workspace-panel">
      <h2 className="text-section-title">{t('create')}</h2>
      <p>{t('createNote')}</p>
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="proposal_id" value={proposalId} />
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
