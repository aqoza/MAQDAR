'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { fieldValues, type ActionState } from '@/lib/forms'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import { simulationRequestSchema } from '@/lib/policy-simulation'
import { sensitivityRequestSchema } from '@/lib/policy-sensitivity'
import { configurationsRequestSchema } from '@/lib/policy-configurations'
import { constraintsRequestSchema } from '@/lib/policy-constraints'

export async function enqueueSensitivity(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const values = fieldValues(form, ['source_run_id', 'request_id', 'maxima', 'reuse_confirmed'])
  const parsed = sensitivityRequestSchema.safeParse(values)
  if (!parsed.success) return { ...(await invalidState('validation')), values }
  const db = await createClient()
  const { data, error } = await db.rpc('simulation_sensitivity_enqueue', {
    p_organization_id: guard.organizationId,
    p_source_run_id: parsed.data.source_run_id,
    p_request_id: parsed.data.request_id,
    p_alternative_maxima: parsed.data.maxima,
    p_reuse_confirmed: true,
  })
  if (error) return { ...(await rpcErrorState(error)), values }
  revalidatePath('/forecasts')
  revalidatePath('/forecasts/simulations')
  redirect(`/forecasts/simulations/${data}`)
}

export async function enqueueSimulation(_state: ActionState, form: FormData): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const values = fieldValues(form, [
    'policy_id',
    'request_id',
    'to_date',
    'opening_stock',
    'alternative_maximum',
    'history_confirmed',
    'empty_start_confirmed',
  ])
  const parsed = simulationRequestSchema.safeParse(values)
  if (!parsed.success) return { ...(await invalidState('validation')), values }
  const input = parsed.data
  const db = await createClient()
  const { data, error } = await db.rpc('simulation_enqueue', {
    p_organization_id: guard.organizationId,
    p_policy_id: input.policy_id,
    p_request_id: input.request_id,
    p_to: input.to_date,
    p_opening_stock: input.opening_stock,
    p_alternative_maximum: input.alternative_maximum,
    p_history_confirmed: true,
    p_empty_start_confirmed: true,
  })
  if (error) {
    if (error.code === 'MQ409') {
      const t = await getTranslations('PolicySimulation')
      return { status: 'error', code: error.code, message: t('conflict'), values }
    }
    return { ...(await rpcErrorState(error)), values }
  }
  revalidatePath('/forecasts')
  revalidatePath('/forecasts/simulations')
  redirect(`/forecasts/simulations/${data}`)
}

export async function enqueueConfigurations(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const values = fieldValues(form, [
    'source_run_id',
    'request_id',
    'configurations',
    'reuse_confirmed',
  ])
  const parsed = configurationsRequestSchema.safeParse(values)
  if (!parsed.success) return { ...(await invalidState('validation')), values }
  const db = await createClient()
  const { data, error } = await db.rpc('simulation_configurations_enqueue', {
    p_organization_id: guard.organizationId,
    p_source_run_id: parsed.data.source_run_id,
    p_request_id: parsed.data.request_id,
    p_configurations: parsed.data.configurations,
    p_reuse_confirmed: true,
  })
  if (error) {
    if (error.code === 'MQ409') {
      const t = await getTranslations('PolicySimulation')
      return { status: 'error', code: error.code, message: t('conflict'), values }
    }
    return { ...(await rpcErrorState(error)), values }
  }
  revalidatePath('/forecasts')
  revalidatePath('/forecasts/simulations')
  redirect(`/forecasts/simulations/${data}`)
}

export async function enqueueConstraints(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const values = fieldValues(form, [
    'source_run_id',
    'request_id',
    'configurations',
    'reuse_confirmed',
  ])
  const parsed = constraintsRequestSchema.safeParse(values)
  if (!parsed.success) return { ...(await invalidState('validation')), values }
  const db = await createClient()
  const { data, error } = await db.rpc('simulation_constraints_enqueue', {
    p_organization_id: guard.organizationId,
    p_source_run_id: parsed.data.source_run_id,
    p_request_id: parsed.data.request_id,
    p_configurations: parsed.data.configurations,
    p_reuse_confirmed: true,
  })
  if (error) {
    if (error.code === 'MQ409') {
      const t = await getTranslations('PolicySimulation')
      return { status: 'error', code: error.code, message: t('conflict'), values }
    }
    return { ...(await rpcErrorState(error)), values }
  }
  revalidatePath('/forecasts')
  revalidatePath('/forecasts/simulations')
  redirect(`/forecasts/simulations/${data}`)
}
