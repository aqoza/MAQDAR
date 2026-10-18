'use server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { fieldValues, type ActionState } from '@/lib/forms'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import { excessSaveSchema } from '@/lib/excess-stock'

export async function saveExcessStock(_state: ActionState, form: FormData): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const values = fieldValues(form, [
    'selections',
    'reason',
    'confirmed',
    'request_id',
    'fingerprint',
  ])
  const parsed = excessSaveSchema.safeParse(values)
  if (!parsed.success) return { ...(await invalidState('validation')), values }
  const v = parsed.data
  const db = await createClient()
  const { data, error } = await db.rpc('excess_stock_save', {
    p_organization_id: guard.organizationId,
    p_selections: v.selections,
    p_reason: v.reason,
    p_confirmed: true,
    p_request_id: v.request_id,
    p_fingerprint: v.fingerprint,
  })
  if (error?.code === 'MQ409')
    return { status: 'error', message: (await getTranslations('ExcessStock'))('changed'), values }
  if (error) return { ...(await rpcErrorState(error)), values }
  revalidatePath('/replenishment/excess')
  redirect(`/replenishment/excess/${data}`)
}
