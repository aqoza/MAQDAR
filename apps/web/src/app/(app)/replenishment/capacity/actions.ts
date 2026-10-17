'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { fieldValues, type ActionState } from '@/lib/forms'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import { capacitySaveSchema } from '@/lib/container-capacity'

export async function saveCapacity(_state: ActionState, form: FormData): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const values = fieldValues(form, [
    'batch',
    'volume',
    'payload',
    'confirmed',
    'request_id',
    'fingerprint',
  ])
  const parsed = capacitySaveSchema.safeParse(values)
  if (!parsed.success || parsed.data.confirmed !== 'true')
    return { ...(await invalidState('validation')), values }
  const db = await createClient()
  const v = parsed.data
  const { data, error } = await db.rpc('container_capacity_save', {
    p_organization_id: guard.organizationId,
    p_batch_id: v.batch,
    p_volume: v.volume,
    p_payload: v.payload,
    p_confirmed: true,
    p_request_id: v.request_id,
    p_fingerprint: v.fingerprint,
  })
  if (error?.code === 'MQ409') {
    const t = await getTranslations('ContainerCapacity')
    return { status: 'error', message: t('changed'), values }
  }
  if (error) return { ...(await rpcErrorState(error)), values }
  revalidatePath(`/replenishment/batches/${v.batch}`)
  redirect(`/replenishment/capacity/${data}`)
}
