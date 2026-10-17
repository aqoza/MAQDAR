'use client'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { saveCapacity } from '@/app/(app)/replenishment/capacity/actions'
import { idleState } from '@/lib/forms'
import type { z } from 'zod'
import type { capacitySaveSchema } from '@/lib/container-capacity'

export function ContainerCapacitySave({
  organizationId,
  input,
}: {
  organizationId: string
  input: z.output<typeof capacitySaveSchema>
}) {
  const t = useTranslations('ContainerCapacity')
  const [state, action, pending] = useActionState(saveCapacity, idleState)
  return (
    <form action={action} className="space-y-3" aria-label={t('save')}>
      {Object.entries({ organization_id: organizationId, ...input }).map(([name, value]) => (
        <input type="hidden" key={name} name={name} value={value} />
      ))}
      <p className="text-sm text-muted-foreground">{t('saveNote')}</p>
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
