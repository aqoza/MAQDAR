'use server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import type { ActionState } from '@/lib/forms'
export async function publishEventSupplier(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const id = z.guid().safeParse(form.get('handoff_id'))
  if (!id.success) return invalidState('validation')
  const db = await createClient()
  const { error } = await db.rpc('supplier_event_publication_publish', {
    p_organization_id: guard.organizationId,
    p_handoff_id: id.data,
    p_confirmed: form.get('confirmed') === 'on',
    p_fingerprint: String(form.get('fingerprint') ?? ''),
  })
  if (error) return rpcErrorState(error)
  revalidatePath(`/replenishment/events/handoffs/${id.data}/publish`)
  redirect(`/replenishment/events/handoffs/${id.data}/publish`)
}
export async function withdrawEventSupplier(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const input = z
    .object({ publication: z.guid(), handoff: z.guid() })
    .safeParse({ publication: form.get('publication_id'), handoff: form.get('handoff_id') })
  if (!input.success) return invalidState('validation')
  const db = await createClient()
  const { error } = await db.rpc('supplier_event_publication_withdraw', {
    p_organization_id: guard.organizationId,
    p_publication_id: input.data.publication,
  })
  if (error) return rpcErrorState(error)
  revalidatePath('/supplier-portal', 'layout')
  revalidatePath(`/replenishment/events/handoffs/${input.data.handoff}/publish`)
  return { status: 'success' }
}
