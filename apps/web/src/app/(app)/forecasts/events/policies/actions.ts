'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import type { ActionState } from '@/lib/forms'
import {
  eventPolicyFormValues,
  eventPolicyInputSchema,
  eventPolicySaveSchema,
  eventPolicyReportSchema,
  eventPolicyStatuses,
  type EventPolicyInput,
  type EventPolicyReport,
} from '@/lib/event-policies'

export type EventPolicyPreviewState = ActionState & {
  report?: EventPolicyReport
  input?: EventPolicyInput
}
function args(org: string, input: EventPolicyInput) {
  return {
    p_organization_id: org,
    p_event_id: input.event_id,
    p_policy_id: input.policy_id,
    p_reason: input.reason,
  }
}
export async function previewEventPolicy(
  _state: EventPolicyPreviewState,
  form: FormData,
): Promise<EventPolicyPreviewState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const parsed = eventPolicyInputSchema.safeParse(eventPolicyFormValues(form))
  if (!parsed.success) return invalidState('validation')
  const db = await createClient()
  const { data, error } = await db.rpc(
    'event_policy_preview',
    args(guard.organizationId, parsed.data),
  )
  if (error) return rpcErrorState(error)
  const status = z.object({ status: z.enum(eventPolicyStatuses) }).parse(data).status
  if (status !== 'available')
    return {
      status: 'error',
      message: (await getTranslations('EventPolicies'))(`statuses.${status}`),
    }
  return { status: 'success', input: parsed.data, report: eventPolicyReportSchema.parse(data) }
}
export async function saveEventPolicy(_state: ActionState, form: FormData): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const parsed = eventPolicySaveSchema.safeParse(eventPolicyFormValues(form))
  if (!parsed.success) return invalidState('validation')
  const db = await createClient()
  const { data, error } = await db.rpc('event_policy_save', {
    ...args(guard.organizationId, parsed.data),
    p_request_id: parsed.data.request_id,
    p_fingerprint: parsed.data.fingerprint,
  })
  if (error?.code === 'MQ409')
    return { status: 'error', message: (await getTranslations('EventPolicies'))('changed') }
  if (error) return rpcErrorState(error)
  revalidatePath('/forecasts/events/policies')
  redirect(`/forecasts/events/policies/${data}`)
}
