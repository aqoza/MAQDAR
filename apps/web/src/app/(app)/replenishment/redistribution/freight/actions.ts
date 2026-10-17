'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { fieldValues, type ActionState } from '@/lib/forms'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import { transferFreightSaveSchema, transferFreightRpcInput } from '@/lib/transfer-freight'

export async function saveTransferFreight(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const values = fieldValues(form, ['scenario', 'confirmed', 'request_id', 'fingerprint'])
  const parsed = transferFreightSaveSchema.safeParse(values)
  if (!parsed.success) return { ...(await invalidState('validation')), values }
  const db = await createClient()
  const { data, error } = await db.rpc('transfer_freight_save', {
    p_organization_id: guard.organizationId,
    ...transferFreightRpcInput(parsed.data),
    p_request_id: parsed.data.request_id,
    p_fingerprint: parsed.data.fingerprint,
  })
  if (error?.code === 'MQ409') {
    const t = await getTranslations('TransferFreight')
    return { status: 'error', message: t('changed'), values }
  }
  if (error) return { ...(await rpcErrorState(error)), values }
  revalidatePath('/replenishment/redistribution/freight')
  redirect(`/replenishment/redistribution/freight/${data}`)
}
