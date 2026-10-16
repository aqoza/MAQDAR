'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { saveDeliveryScenario } from '@/app/(app)/replenishment/deliveries/actions'
import { idleState } from '@/lib/forms'
import type { z } from 'zod'
import type { deliveryScenarioSaveSchema } from '@/lib/delivery-scenarios'

export function DeliveryScenarioSaveForm({
  organizationId,
  input,
}: {
  organizationId: string
  input: z.infer<typeof deliveryScenarioSaveSchema>
}) {
  const t = useTranslations('DeliveryScenarios')
  const [state, action, pending] = useActionState(saveDeliveryScenario, idleState)
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
