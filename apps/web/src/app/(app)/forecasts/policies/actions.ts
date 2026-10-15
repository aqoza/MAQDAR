'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { fieldValues, type ActionState } from '@/lib/forms'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import { policyRequestSchema } from '@/lib/inventory-policy'

export async function enqueuePolicy(_state: ActionState, form: FormData): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const values = fieldValues(form, [
    'forecast_id',
    'request_id',
    'lead_time',
    'review_interval',
    'service_percent',
  ])
  const parsed = policyRequestSchema.safeParse(values)
  if (!parsed.success) return { ...(await invalidState('validation')), values }
  const data = parsed.data
  const db = await createClient()
  const { error } = await db.rpc('policy_enqueue', {
    p_organization_id: guard.organizationId,
    p_forecast_id: data.forecast_id,
    p_request_id: data.request_id,
    p_lead_time: data.lead_time,
    p_review_interval: data.review_interval,
    p_service_level: Number((data.service_percent / 100).toFixed(3)),
  })
  if (error) return { ...(await rpcErrorState(error)), values }
  revalidatePath('/forecasts')
  redirect('/forecasts')
}
