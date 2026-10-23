'use server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { ActionState } from '@/lib/forms'
import { invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { requireSupplierPortal } from '@/lib/supplier-portal-context'
import { createClient } from '@/lib/supabase/server'
export async function acceptSupplier(_state: ActionState, form: FormData): Promise<ActionState> {
  const id = z.guid().safeParse(form.get('grant_id'))
  if (!id.success) return invalidState('validation')
  await requireSupplierPortal(id.data)
  const db = await createClient()
  const { error } = await db.rpc('supplier_portal_accept', { p_grant_id: id.data })
  if (error) return rpcErrorState(error)
  revalidatePath('/supplier-portal', 'layout')
  redirect(`/supplier-portal/${id.data}`)
}
