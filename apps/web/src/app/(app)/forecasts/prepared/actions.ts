'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { fieldValues, type ActionState } from '@/lib/forms'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import { preparedForecastSchema } from '@/lib/prepared-forecast'

export async function enqueuePreparedForecast(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const values = fieldValues(form, ['preparation_id', 'request_id', 'horizon'])
  const t = await getTranslations('PreparedForecast')
  if (form.get('fixed_group_confirmed') !== 'on')
    return { status: 'error', message: t('confirmationRequired'), values }
  const parsed = preparedForecastSchema.safeParse(values)
  if (!parsed.success) return { ...(await invalidState('validation')), values }
  const db = await createClient()
  const { error } = await db.rpc('forecast_prepared_enqueue', {
    p_organization_id: guard.organizationId,
    p_preparation_id: parsed.data.preparation_id,
    p_request_id: parsed.data.request_id,
    p_horizon: parsed.data.horizon,
    p_fixed_group_confirmed: true,
  })
  if (error) return { ...(await rpcErrorState(error)), values }
  revalidatePath('/forecasts')
  redirect('/forecasts')
}
