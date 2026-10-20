'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { fieldValues, type ActionState } from '@/lib/forms'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import { networkFreightSaveSchema, networkFreightRpcInput } from '@/lib/network-freight'

export async function saveNetworkFreight(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const values = fieldValues(form, ['scenario', 'confirmed', 'request_id', 'fingerprint'])
  const parsed = networkFreightSaveSchema.safeParse(values)
  if (!parsed.success) return { ...(await invalidState('validation')), values }
  const db = await createClient()
  const { data, error } = await db.rpc('network_freight_save', {
    p_organization_id: guard.organizationId,
    ...networkFreightRpcInput(parsed.data),
    p_request_id: parsed.data.request_id,
    p_fingerprint: parsed.data.fingerprint,
  })
  if (error?.code === 'MQ409') {
    const t = await getTranslations('NetworkFreight')
    return { status: 'error', message: t('changed'), values }
  }
  if (error) return { ...(await rpcErrorState(error)), values }
  revalidatePath('/replenishment/network/freight')
  redirect(`/replenishment/network/freight/${data}`)
}
