'use client'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { idleState, type ActionState } from '@/lib/forms'
export function SupplierPortalForm({
  action,
  fields,
  label,
  confirm,
  invite = false,
  supplierCode = '',
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>
  fields: Record<string, string>
  label: 'invite' | 'revoke' | 'accept' | 'publish' | 'withdraw'
  confirm?: boolean
  invite?: boolean
  supplierCode?: string
}) {
  const t = useTranslations('SupplierPortal')
  const [state, submit, pending] = useActionState(action, idleState)
  return (
    <form action={submit} className="space-y-3" aria-label={t(label)}>
      {Object.entries(fields).map(([name, value]) => (
        <input type="hidden" key={name} name={name} value={value} />
      ))}
      {invite && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1">
            {t('supplier_code')}
            <input
              className="w-full min-w-0 rounded-md border bg-background p-2"
              name="supplier_code"
              defaultValue={state.values?.supplier_code ?? supplierCode}
              required
              maxLength={64}
            />
          </label>
          <label className="grid gap-1">
            {t('email')}
            <input
              className="w-full min-w-0 rounded-md border bg-background p-2"
              type="email"
              name="email"
              required
              maxLength={254}
              defaultValue={state.values?.email ?? ''}
            />
          </label>
        </div>
      )}
      {confirm && (
        <label className="flex min-h-11 items-start gap-2 py-2">
          <input className="mt-1" type="checkbox" name="confirmed" required />
          {t('confirm')}
        </label>
      )}
      <button
        disabled={pending}
        className="min-h-11 rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50 md:min-h-9"
      >
        {pending ? t('working') : t(label)}
      </button>
      {state.message && <p role="alert">{state.message}</p>}
    </form>
  )
}
