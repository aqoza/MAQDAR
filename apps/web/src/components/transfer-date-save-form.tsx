'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import type { z } from 'zod'
import { saveTransferDates } from '@/app/(app)/replenishment/redistribution/dates/actions'
import { idleState } from '@/lib/forms'
import type { transferDateSaveSchema } from '@/lib/transfer-dates'

export function TransferDateSaveForm({
  organizationId,
  input,
}: {
  organizationId: string
  input: z.infer<typeof transferDateSaveSchema>
}) {
  const t = useTranslations('TransferDates')
  const [state, action, pending] = useActionState(saveTransferDates, idleState)
  return (
    <form action={action} className="space-y-3" aria-label={t('save')}>
      {Object.entries({ organization_id: organizationId, ...input }).map(([name, value]) => (
        <input type="hidden" key={name} name={name} value={value} />
      ))}
      <p className="text-sm text-muted-foreground">{t('noGuarantee')}</p>
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
