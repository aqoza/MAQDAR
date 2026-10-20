'use server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { fieldValues, type ActionState } from '@/lib/forms'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import { networkSaveSchema, networkRpcInput } from '@/lib/network-allocation'

export async function saveNetworkAllocation(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const values = fieldValues(form, [
    'policy',
    'maximum',
    'backorders',
    'commitments',
    'lanes',
    'request_id',
    'fingerprint',
  ])
  const parsed = networkSaveSchema.safeParse({ ...values, drafts: form.getAll('draft') })
  if (!parsed.success) return invalidState('validation')
  const db = await createClient()
  const { data, error } = await db.rpc('network_allocation_save', {
    p_organization_id: guard.organizationId,
    ...networkRpcInput(parsed.data),
    p_request_id: parsed.data.request_id,
    p_fingerprint: parsed.data.fingerprint,
  })
  if (error?.code === 'MQ409') {
    const t = await getTranslations('NetworkAllocation')
    return { status: 'error', message: t('changed') }
  }
  if (error) return rpcErrorState(error)
  revalidatePath('/replenishment/network')
  redirect(`/replenishment/network/${data}`)
}
