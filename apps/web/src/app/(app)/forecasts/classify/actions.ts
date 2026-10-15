'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { fieldValues, type ActionState } from '@/lib/forms'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import { planningRequestSchema } from '@/lib/planning'
import { CLASSIFICATION_FIELDS, classificationOptionsSchema } from '@/lib/classification'

export async function enqueueClassification(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const values = fieldValues(form, [
    'location_code',
    'from_date',
    'to_date',
    'request_id',
    ...CLASSIFICATION_FIELDS,
  ])
  const request = planningRequestSchema.safeParse(values)
  const options = classificationOptionsSchema.safeParse(values)
  const t = await getTranslations('Classification')
  if (form.get('history_complete') !== 'on')
    return { status: 'error', message: t('confirmationRequired'), values }
  if (!request.success || !options.success) return { ...(await invalidState('validation')), values }
  const db = await createClient()
  const { error } = await db.rpc('classification_enqueue', {
    p_organization_id: guard.organizationId,
    p_location_code: request.data.location_code,
    p_from: request.data.from_date,
    p_to: request.data.to_date,
    p_request_id: request.data.request_id,
    p_history_complete: true,
    p_options: options.data,
  })
  if (error) return { ...(await rpcErrorState(error)), values }
  revalidatePath('/forecasts')
  redirect('/forecasts')
}
