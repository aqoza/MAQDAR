'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { fieldValues, type ActionState } from '@/lib/forms'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import { handoffInputSchema } from '@/lib/network-handoffs'

export async function createHandoff(_state: ActionState, form: FormData): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const parsed = handoffInputSchema.safeParse(fieldValues(form, ['proposal_id']))
  if (!parsed.success) return invalidState('validation')
  const db = await createClient()
  const { data, error } = await db.rpc('network_handoff_create', {
    p_organization_id: guard.organizationId,
    p_proposal_id: parsed.data.proposal_id,
  })
  if (error) {
    const messages = {
      network_selection_changed: 'selectionChanged',
      network_freight_changed: 'freightChanged',
      network_timing_required: 'timingRequired',
    } as const
    const key = error.hint as keyof typeof messages
    if (Object.hasOwn(messages, key)) {
      const t = await getTranslations('NetworkHandoffs')
      return { status: 'error', message: t(messages[key]) }
    }
    return rpcErrorState(error)
  }
  revalidatePath('/replenishment/network/handoffs')
  revalidatePath(`/replenishment/network/review/${parsed.data.proposal_id}`)
  redirect(`/replenishment/network/handoffs/${data}`)
}
