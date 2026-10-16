'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { fieldValues, type ActionState } from '@/lib/forms'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import { purchaseCostSaveSchema } from '@/lib/purchase-costs'

export async function savePurchaseCost(_state: ActionState, form: FormData): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const values = fieldValues(form, ['delivery', 'confirmed', 'request_id', 'fingerprint'])
  const parsed = purchaseCostSaveSchema.safeParse(values)
  if (!parsed.success) return { ...(await invalidState('validation')), values }
  const db = await createClient()
  const v = parsed.data
  const { data, error } = await db.rpc('purchase_cost_save', {
    p_organization_id: guard.organizationId,
    p_delivery_id: v.delivery,
    p_price_confirmed: v.confirmed === 'true',
    p_request_id: v.request_id,
    p_fingerprint: v.fingerprint,
  })
  if (error?.code === 'MQ409') {
    const t = await getTranslations('PurchaseCosts')
    return { status: 'error', message: t('changed'), values }
  }
  if (error) return { ...(await rpcErrorState(error)), values }
  revalidatePath(`/replenishment/deliveries/${v.delivery}`)
  redirect(`/replenishment/costs/${data}`)
}
