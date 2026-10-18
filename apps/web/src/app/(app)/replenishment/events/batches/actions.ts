'use server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { type ActionState } from '@/lib/forms'
import { requireEditor, invalidState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import { batchInputSchema, batchErrorKey } from '@/lib/event-handoff-batches'

export async function createBatch(_state: ActionState, form: FormData): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const parsed = batchInputSchema.safeParse(form.getAll('handoff'))
  if (!parsed.success) return invalidState('validation')
  const db = await createClient()
  const { data, error } = await db.rpc('event_purchase_handoff_batch_create', {
    p_organization_id: guard.organizationId,
    p_handoff_ids: parsed.data,
  })
  if (error) {
    const t = await getTranslations('EventHandoffBatches')
    return { status: 'error', message: t(batchErrorKey(error.hint)) }
  }
  revalidatePath('/replenishment/events/batches')
  redirect(`/replenishment/events/batches/${data}`)
}
