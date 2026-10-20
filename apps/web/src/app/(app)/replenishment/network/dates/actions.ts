'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { fieldValues, type ActionState } from '@/lib/forms'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import { networkDateSaveSchema, networkDateRpcInput } from '@/lib/network-dates'

export async function saveNetworkDates(_state: ActionState, form: FormData): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const values = fieldValues(form, [
    'allocation',
    'requested',
    'confirmed',
    'request_id',
    'fingerprint',
  ])
  const parsed = networkDateSaveSchema.safeParse(values)
  if (!parsed.success) return { ...(await invalidState('validation')), values }
  const db = await createClient()
  const { data, error } = await db.rpc('network_date_save', {
    p_organization_id: guard.organizationId,
    ...networkDateRpcInput(parsed.data),
    p_request_id: parsed.data.request_id,
    p_fingerprint: parsed.data.fingerprint,
  })
  if (error?.code === 'MQ409') {
    const t = await getTranslations('NetworkDates')
    return { status: 'error', message: t('changed'), values }
  }
  if (error) return { ...(await rpcErrorState(error)), values }
  revalidatePath('/replenishment/network/dates')
  redirect(`/replenishment/network/dates/${data}`)
}
