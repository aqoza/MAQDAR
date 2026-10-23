'use server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { type ActionState, fieldValues } from '@/lib/forms'
import { invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { requireSupplierPortal } from '@/lib/supplier-portal-context'
import { createClient } from '@/lib/supabase/server'
import { supplierResponseInput } from '@/lib/supplier-responses'
export async function respondSupplier(_state: ActionState, form: FormData): Promise<ActionState> {
  const values = fieldValues(form, [
    'grant_id',
    'publication_id',
    'kind',
    'request_id',
    'status',
    'reference',
    'reason',
  ])
  const parsed = supplierResponseInput.safeParse(values)
  if (!parsed.success) return { ...(await invalidState('validation')), values }
  const v = parsed.data
  await requireSupplierPortal(v.grant_id)
  const db = await createClient()
  const { error } = await db.rpc('supplier_response_submit', {
    p_grant_id: v.grant_id,
    p_kind: v.kind,
    p_publication_id: v.publication_id,
    p_request_id: v.request_id,
    p_status: v.status,
    p_reference: v.reference,
    p_reason: v.reason,
  })
  if (error) return { ...(await rpcErrorState(error)), values }
  const path = `/supplier-portal/${v.grant_id}/${v.publication_id}`
  revalidatePath(path)
  revalidatePath('/replenishment', 'layout')
  redirect(path)
}
