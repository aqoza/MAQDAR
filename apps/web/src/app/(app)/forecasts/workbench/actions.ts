'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { fieldValues, type ActionState } from '@/lib/forms'
import {
  requireActiveOrganization,
  requireEditor,
  invalidState,
  rpcErrorState,
} from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import { decisionSchema, proposalSchema } from '@/lib/policy-workbench'

export async function submitOverride(_state: ActionState, form: FormData): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const values = fieldValues(form, [
    'policy_id',
    'request_id',
    'reorder_point',
    'order_up_to',
    'reason',
  ])
  const parsed = proposalSchema.safeParse(values)
  if (!parsed.success) return { ...(await invalidState('validation')), values }
  const db = await createClient()
  const v = parsed.data
  const { error } = await db.rpc('policy_override_submit', {
    p_organization_id: guard.organizationId,
    p_policy_id: v.policy_id,
    p_request_id: v.request_id,
    p_reorder_point: v.reorder_point,
    p_order_up_to: v.order_up_to,
    p_reason: v.reason,
  })
  if (error) return { ...(await rpcErrorState(error)), values }
  revalidatePath('/forecasts/workbench')
  revalidatePath(`/forecasts/workbench/${v.policy_id}`)
  redirect(`/forecasts/workbench/${v.policy_id}`)
}

export async function decideOverride(_state: ActionState, form: FormData): Promise<ActionState> {
  // Withdrawal is available to the author even after a role change. The RPC checks
  // live membership, branch access, review roles and identity for every decision.
  const guard = await requireActiveOrganization(form)
  if (!guard.ok) return guard.state
  const values = fieldValues(form, ['override_id', 'request_id', 'decision', 'reason'])
  const parsed = decisionSchema.safeParse(values)
  if (!parsed.success) return { ...(await invalidState('validation')), values }
  const db = await createClient()
  const v = parsed.data
  const { data, error } = await db.rpc('policy_override_decide', {
    p_organization_id: guard.organizationId,
    p_override_id: v.override_id,
    p_request_id: v.request_id,
    p_decision: v.decision,
    p_reason: v.reason,
  })
  if (error) return { ...(await rpcErrorState(error)), values }
  revalidatePath('/forecasts/workbench')
  revalidatePath(`/forecasts/workbench/${data}`)
  redirect(`/forecasts/workbench/${data}`)
}
