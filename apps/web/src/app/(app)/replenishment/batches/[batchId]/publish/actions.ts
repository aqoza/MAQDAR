'use server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import type { ActionState } from '@/lib/forms'
export async function publishSupplierBatch(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const id = z.guid().safeParse(form.get('batch_id'))
  if (!id.success) return invalidState('validation')
  const db = await createClient()
  const { error } = await db.rpc('supplier_batch_publication_publish', {
    p_organization_id: guard.organizationId,
    p_batch_id: id.data,
    p_confirmed: form.get('confirmed') === 'on',
    p_fingerprint: String(form.get('fingerprint') ?? ''),
  })
  if (error) return rpcErrorState(error)
  revalidatePath(`/replenishment/batches/${id.data}/publish`)
  redirect(`/replenishment/batches/${id.data}/publish`)
}
export async function withdrawSupplierBatch(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const input = z
    .object({ publication: z.guid(), batch: z.guid() })
    .safeParse({ publication: form.get('publication_id'), batch: form.get('batch_id') })
  if (!input.success) return invalidState('validation')
  const db = await createClient()
  const { error } = await db.rpc('supplier_batch_publication_withdraw', {
    p_organization_id: guard.organizationId,
    p_publication_id: input.data.publication,
  })
  if (error) return rpcErrorState(error)
  revalidatePath('/supplier-portal', 'layout')
  revalidatePath(`/replenishment/batches/${input.data.batch}/publish`)
  return { status: 'success' }
}
