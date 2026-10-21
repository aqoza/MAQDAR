'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { type ActionState } from '@/lib/forms'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import { driverForecastRequest } from '@/lib/driver-forecast'

export async function enqueueDriverForecast(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const t = await getTranslations('DriverForecast')
  if (form.get('confirmed') !== 'on') return { status: 'error', message: t('confirmationRequired') }
  const parsed = driverForecastRequest.safeParse(
    Object.fromEntries(['forecast_id', 'dataset_id', 'request_id'].map((k) => [k, form.get(k)])),
  )
  if (!parsed.success) return invalidState('validation')
  const db = await createClient()
  const { error } = await db.rpc('forecast_driver_enqueue', {
    p_organization_id: guard.organizationId,
    p_forecast_id: parsed.data.forecast_id,
    p_dataset_id: parsed.data.dataset_id,
    p_request_id: parsed.data.request_id,
    p_confirmed: true,
  })
  if (error)
    return error.code === 'MQ422'
      ? { status: 'error', message: t('incompatible') }
      : rpcErrorState(error)
  revalidatePath('/forecasts')
  redirect('/forecasts')
}
