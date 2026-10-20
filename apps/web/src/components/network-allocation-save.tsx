'use client'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import type { z } from 'zod'
import { saveNetworkAllocation } from '@/app/(app)/replenishment/network/actions'
import { idleState } from '@/lib/forms'
import type { networkSaveSchema } from '@/lib/network-allocation'

export function NetworkAllocationSave({
  organizationId,
  input,
}: {
  organizationId: string
  input: z.infer<typeof networkSaveSchema>
}) {
  const t = useTranslations('NetworkAllocation')
  const [state, action, pending] = useActionState(saveNetworkAllocation, idleState)
  const { drafts, ...fields } = input
  return (
    <form action={action} className="space-y-3" aria-label={t('save')}>
      {Object.entries({ organization_id: organizationId, ...fields }).map(([name, value]) => (
        <input type="hidden" key={name} name={name} value={value} />
      ))}
      {drafts.map((id) => (
        <input type="hidden" key={id} name="draft" value={id} />
      ))}
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
