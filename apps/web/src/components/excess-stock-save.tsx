'use client'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { saveExcessStock } from '@/app/(app)/replenishment/excess/actions'
import { idleState } from '@/lib/forms'
import type { ExcessReport } from '@/lib/excess-stock'

export function ExcessStockSave({
  organizationId,
  selections,
  fingerprint,
  requestId,
}: {
  organizationId: string
  selections: ExcessReport['selections']
  fingerprint: string
  requestId: string
}) {
  const t = useTranslations('ExcessStock')
  const [state, action, pending] = useActionState(saveExcessStock, idleState)
  return (
    <form action={action} className="workspace-panel space-y-3" aria-label={t('save')}>
      {Object.entries({
        organization_id: organizationId,
        selections: JSON.stringify(selections),
        fingerprint,
        request_id: requestId,
      }).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <label className="grid gap-1">
        {t('reason')}
        <textarea
          name="reason"
          maxLength={2000}
          required
          rows={2}
          defaultValue={state.values?.reason ?? ''}
          className="w-full rounded-md border bg-background p-2"
        />
      </label>
      <label className="flex items-start gap-2">
        <input type="checkbox" name="confirmed" value="true" required className="mt-1" />
        <span>{t('confirm')}</span>
      </label>
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
