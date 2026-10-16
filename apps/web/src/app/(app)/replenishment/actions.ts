'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { fieldValues, type ActionState } from '@/lib/forms'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import { draftSaveSchema } from '@/lib/replenishment'

export async function saveDraft(_state: ActionState, form: FormData): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const values = fieldValues(form, [
    'policy',
    'basis',
    'override',
    'backorders',
    'confirmed',
    'request_id',
    'fingerprint',
  ])
  const parsed = draftSaveSchema.safeParse({ ...values, override: values.override || undefined })
  if (!parsed.success) return { ...(await invalidState('validation')), values }
  const db = await createClient()
  const v = parsed.data
  const { data, error } = await db.rpc('replenishment_save', {
    p_organization_id: guard.organizationId,
    p_policy_id: v.policy,
    p_request_id: v.request_id,
    p_basis: v.basis,
    ...(v.override ? { p_override_id: v.override } : {}),
    p_backorders: v.backorders,
    p_orders_confirmed: v.confirmed === 'true',
    p_fingerprint: v.fingerprint,
  })
  if (error?.code === 'MQ409') {
    const t = await getTranslations('Replenishment')
    return { status: 'error', message: t('changed'), values }
  }
  if (error) return { ...(await rpcErrorState(error)), values }
  revalidatePath('/replenishment')
  redirect(`/replenishment/${data}`)
}
