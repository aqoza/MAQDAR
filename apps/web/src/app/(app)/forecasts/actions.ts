'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { type ActionState, fieldValues } from '@/lib/forms'
import { requireEditor, rpcErrorState, invalidState } from '@/lib/organizations/guard'
import { planningRequestSchema } from '@/lib/planning'
import { createClient } from '@/lib/supabase/server'

export async function enqueueRun(_state: ActionState, form: FormData): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const values = fieldValues(form, ['location_code', 'from_date', 'to_date', 'request_id'])
  const parsed = planningRequestSchema.safeParse(values)
  if (!parsed.success) return { ...(await invalidState('validation')), values }
  const db = await createClient()
  const { error } = await db.rpc('planning_enqueue', {
    p_organization_id: guard.organizationId,
    p_location_code: parsed.data.location_code,
    p_from: parsed.data.from_date,
    p_to: parsed.data.to_date,
    p_request_id: parsed.data.request_id,
  })
  if (error) {
    const t = await getTranslations('Planning')
    const message =
      error.code === 'MQ409'
        ? t('busy')
        : error.code === 'MQ429'
          ? t('limit')
          : error.code === 'MQ422'
            ? t('invalid')
            : undefined
    return { ...(await rpcErrorState(error)), ...(message ? { message } : {}), values }
  }
  revalidatePath('/forecasts')
  redirect('/forecasts')
}

export async function cancelRun(_state: ActionState, form: FormData): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const run = z.guid().safeParse(form.get('run_id'))
  if (!run.success) return invalidState('validation')
  const db = await createClient()
  const { error } = await db.rpc('planning_cancel', {
    p_organization_id: guard.organizationId,
    p_run_id: run.data,
  })
  if (error) return rpcErrorState(error)
  revalidatePath('/forecasts')
  redirect('/forecasts')
}
