'use server'

import { getTranslations } from 'next-intl/server'
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
import { decisionSchema, proposalSchema } from '@/lib/regional-review'

export async function submitProposal(_state: ActionState, form: FormData): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const values = fieldValues(form, ['estimate_id', 'request_id', 'reason'])
  const parsed = proposalSchema.safeParse(values)
  if (!parsed.success) return { ...(await invalidState('validation')), values }
  const db = await createClient()
  const v = parsed.data
  const { data, error } = await db.rpc('regional_transfer_submit', {
    p_organization_id: guard.organizationId,
    p_estimate_id: v.estimate_id,
    p_request_id: v.request_id,
    p_reason: v.reason,
  })
  if (error) return { ...(await reviewError(error)), values }
  revalidatePath('/replenishment/regional-stock/sourcing/review')
  revalidatePath(`/replenishment/regional-stock/sourcing/review/${data}`)
  redirect(`/replenishment/regional-stock/sourcing/review/${data}`)
}

export async function decideProposal(_state: ActionState, form: FormData): Promise<ActionState> {
  // Withdrawal is available to the author even after a role change. The RPC checks
  // live membership, branch access, review roles and identity for every decision.
  const guard = await requireActiveOrganization(form)
  if (!guard.ok) return guard.state
  const values = fieldValues(form, ['proposal_id', 'request_id', 'decision', 'reason'])
  const parsed = decisionSchema.safeParse(values)
  if (!parsed.success) return { ...(await invalidState('validation')), values }
  const db = await createClient()
  const v = parsed.data
  const { data, error } = await db.rpc('regional_transfer_decide', {
    p_organization_id: guard.organizationId,
    p_proposal_id: v.proposal_id,
    p_request_id: v.request_id,
    p_decision: v.decision,
    p_reason: v.reason,
  })
  if (error) return { ...(await reviewError(error)), values }
  revalidatePath('/replenishment/regional-stock/sourcing/review')
  revalidatePath(`/replenishment/regional-stock/sourcing/review/${data}`)
  redirect(`/replenishment/regional-stock/sourcing/review/${data}`)
}

async function reviewError(error: { code?: string; hint?: string | null }) {
  const messages = {
    regional_freight_changed: 'freightChanged',
    regional_pending: 'pendingNote',
    regional_timing_required: 'timingRequired',
  } as const
  const key = error.hint as keyof typeof messages
  if (Object.hasOwn(messages, key)) {
    const t = await getTranslations('RegionalReview')
    return { status: 'error' as const, message: t(messages[key]) }
  }
  return rpcErrorState(error)
}
