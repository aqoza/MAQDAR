'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import type { z } from 'zod'
import { saveTransferFreight } from '@/app/(app)/replenishment/redistribution/freight/actions'
import { idleState } from '@/lib/forms'
import type { transferFreightSaveSchema } from '@/lib/transfer-freight'

export function TransferFreightSaveForm({
  organizationId,
  input,
}: {
  organizationId: string
  input: z.infer<typeof transferFreightSaveSchema>
}) {
  const t = useTranslations('TransferFreight')
  const [state, action, pending] = useActionState(saveTransferFreight, idleState)
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
