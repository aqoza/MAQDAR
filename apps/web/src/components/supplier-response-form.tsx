'use client'
import { useActionState, useState } from 'react'
import { useTranslations } from 'next-intl'
import { idleState, type ActionState } from '@/lib/forms'
export function SupplierResponseForm({
  action,
  fields,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>
  fields: Record<string, string>
}) {
  const t = useTranslations('SupplierPortal.responses')
  const [state, submit, pending] = useActionState(action, idleState)
  const [status, setStatus] = useState('received')
  return (
    <section className="workspace-panel space-y-3" aria-label={t('respond')}>
      <h2 className="text-section-title">{t('respond')}</h2>
      <p className="text-xs text-muted-foreground">{t('meaning')}</p>
      <form action={submit} className="space-y-3">
        {Object.entries(fields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1">
            {t('status')}
            <select
              name="status"
              aria-label={t('status')}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="min-h-11 w-full min-w-0 rounded-md border bg-background p-2"
            >
              <option value="received">{t('received')}</option>
              <option value="declined">{t('declined')}</option>
            </select>
          </label>
          <label className="grid gap-1">
            {t('reference')}
            <input
              name="reference"
              maxLength={120}
              defaultValue={state.values?.reference ?? ''}
              className="min-h-11 w-full min-w-0 rounded-md border bg-background p-2"
            />
          </label>
        </div>
        <label className="grid gap-1">
          {t(status === 'declined' ? 'requiredReason' : 'reason')}
          <textarea
            name="reason"
            required={status === 'declined'}
            maxLength={2000}
            rows={3}
            defaultValue={state.values?.reason ?? ''}
            className="w-full min-w-0 rounded-md border bg-background p-2"
          />
        </label>
        <button
          disabled={pending}
          className="min-h-11 rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
        >
          {t(pending ? 'working' : 'submit')}
        </button>
        {state.message && <p role="alert">{state.message}</p>}
      </form>
    </section>
  )
}
