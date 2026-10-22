'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { fieldValues, type ActionState } from '@/lib/forms'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import { regionalFreightSaveSchema, regionalFreightRpcInput } from '@/lib/regional-freight'

export async function saveRegionalFreight(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const values = fieldValues(form, ['scenario', 'confirmed', 'request_id', 'fingerprint'])
  const parsed = regionalFreightSaveSchema.safeParse(values)
  if (!parsed.success) return { ...(await invalidState('validation')), values }
  const db = await createClient()
  const { data, error } = await db.rpc('regional_freight_save', {
    p_organization_id: guard.organizationId,
    ...regionalFreightRpcInput(parsed.data),
    p_request_id: parsed.data.request_id,
    p_fingerprint: parsed.data.fingerprint,
  })
  if (error?.code === 'MQ409') {
    const t = await getTranslations('RegionalFreight')
    return { status: 'error', message: t('changed'), values }
  }
  if (error) return { ...(await rpcErrorState(error)), values }
  revalidatePath('/replenishment/regional-stock/sourcing/freight')
  redirect(`/replenishment/regional-stock/sourcing/freight/${data}`)
}
