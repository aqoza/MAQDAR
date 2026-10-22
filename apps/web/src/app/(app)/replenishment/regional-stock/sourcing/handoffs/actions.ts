'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { fieldValues, type ActionState } from '@/lib/forms'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import { handoffInputSchema } from '@/lib/regional-handoffs'

export async function createHandoff(_state: ActionState, form: FormData): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const parsed = handoffInputSchema.safeParse(fieldValues(form, ['proposal_id']))
  if (!parsed.success) return invalidState('validation')
  const db = await createClient()
  const { data, error } = await db.rpc('regional_handoff_create', {
    p_organization_id: guard.organizationId,
    p_proposal_id: parsed.data.proposal_id,
  })
  if (error) {
    const messages = {
      regional_selection_changed: 'selectionChanged',
      regional_freight_changed: 'freightChanged',
      regional_timing_required: 'timingRequired',
    } as const
    const key = error.hint as keyof typeof messages
    if (Object.hasOwn(messages, key)) {
      const t = await getTranslations('RegionalHandoffs')
      return { status: 'error', message: t(messages[key]) }
    }
    return rpcErrorState(error)
  }
  revalidatePath('/replenishment/regional-stock/sourcing/handoffs')
  revalidatePath(`/replenishment/regional-stock/sourcing/review/${parsed.data.proposal_id}`)
  redirect(`/replenishment/regional-stock/sourcing/handoffs/${data}`)
}
