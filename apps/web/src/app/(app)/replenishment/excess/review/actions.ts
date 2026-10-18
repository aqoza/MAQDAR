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
import { dispositionInputSchema, decisionSchema } from '@/lib/excess-disposition'

async function dispositionError(error: { code?: string; hint?: string | null }) {
  const messages = {
    excess_disposition_changed: 'changed',
    excess_disposition_pending: 'pendingNote',
    excess_disposition_quantity: 'quantityInvalid',
  } as const
  const key = error.hint as keyof typeof messages
  if (Object.hasOwn(messages, key))
    return {
      status: 'error' as const,
      message: (await getTranslations('ExcessDisposition'))(messages[key]),
    }
  return rpcErrorState(error)
}
export async function submitDisposition(_state: ActionState, form: FormData): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const values = fieldValues(form, [
    'assessment_id',
    'item_id',
    'request_id',
    'kind',
    'quantity',
    'reason',
  ])
  const parsed = dispositionInputSchema.safeParse(values)
  if (!parsed.success) return { ...(await invalidState('validation')), values }
  const v = parsed.data
  const db = await createClient()
  const { data, error } = await db.rpc('excess_disposition_submit', {
    p_organization_id: guard.organizationId,
    p_assessment_id: v.assessment_id,
    p_item_id: v.item_id,
    p_kind: v.kind,
    p_quantity: v.quantity,
    p_request_id: v.request_id,
    p_reason: v.reason,
  })
  if (error) return { ...(await dispositionError(error)), values }
  revalidatePath('/replenishment/excess/review')
  redirect(`/replenishment/excess/review/${data}`)
}
export async function decideDisposition(_state: ActionState, form: FormData): Promise<ActionState> {
  // Authors retain withdrawal while they remain members with location access, even after demotion.
  const guard = await requireActiveOrganization(form)
  if (!guard.ok) return guard.state
  const values = fieldValues(form, ['proposal_id', 'request_id', 'decision', 'reason'])
  const parsed = decisionSchema.safeParse(values)
  if (!parsed.success) return { ...(await invalidState('validation')), values }
  const v = parsed.data
  const db = await createClient()
  const { data, error } = await db.rpc('excess_disposition_decide', {
    p_organization_id: guard.organizationId,
    p_proposal_id: v.proposal_id,
    p_request_id: v.request_id,
    p_decision: v.decision,
    p_reason: v.reason,
  })
  if (error) return { ...(await dispositionError(error)), values }
  revalidatePath('/replenishment/excess/review')
  revalidatePath(`/replenishment/excess/review/${data}`)
  redirect(`/replenishment/excess/review/${data}`)
}
