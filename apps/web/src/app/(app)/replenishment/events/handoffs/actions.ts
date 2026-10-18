'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { fieldValues, type ActionState } from '@/lib/forms'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import { handoffInputSchema } from '@/lib/event-purchase-handoffs'

export async function createHandoff(_state: ActionState, form: FormData): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const parsed = handoffInputSchema.safeParse(fieldValues(form, ['proposal_id']))
  if (!parsed.success) return invalidState('validation')
  const db = await createClient()
  const { data, error } = await db.rpc('event_purchase_handoff_create', {
    p_organization_id: guard.organizationId,
    p_proposal_id: parsed.data.proposal_id,
  })
  if (error) {
    const messages = {
      handoff_selection_changed: 'selectionChanged',
      event_purchase_price_changed: 'priceChanged',
      event_purchase_policy_required: 'policyRequired',
      event_purchase_timing_required: 'timingRequired',
    } as const
    const key = error.hint as keyof typeof messages
    if (Object.hasOwn(messages, key)) {
      const t = await getTranslations('EventPurchaseHandoffs')
      return { status: 'error', message: t(messages[key]) }
    }
    return rpcErrorState(error)
  }
  revalidatePath('/replenishment/events/handoffs')
  revalidatePath(`/replenishment/events/review/${parsed.data.proposal_id}`)
  redirect(`/replenishment/events/handoffs/${data}`)
}
