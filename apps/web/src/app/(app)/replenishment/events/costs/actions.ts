'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import type { ActionState } from '@/lib/forms'
import {
  eventCostStatuses,
  eventCostFormValues,
  eventCostInputSchema,
  eventCostSaveSchema,
  eventCostReportSchema,
  type EventCostInput,
  type EventCostReport,
} from '@/lib/event-costs'

export type EventCostPreviewState = ActionState & {
  input?: EventCostInput
  report?: EventCostReport
}
function args(org: string, input: EventCostInput) {
  return {
    p_organization_id: org,
    p_delivery_id: input.delivery_id,
    p_price_confirmed: input.price_confirmed,
  }
}
export async function previewEventCost(
  _state: EventCostPreviewState,
  form: FormData,
): Promise<EventCostPreviewState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const parsed = eventCostInputSchema.safeParse(eventCostFormValues(form))
  if (!parsed.success) return invalidState('validation')
  const db = await createClient()
  const { data, error } = await db.rpc(
    'event_purchase_cost_preview',
    args(guard.organizationId, parsed.data),
  )
  if (error) return rpcErrorState(error)
  const status = z.object({ status: z.enum(eventCostStatuses) }).parse(data).status
  if (status === 'source_unavailable')
    return { status: 'error', message: (await getTranslations('EventCosts'))(`statuses.${status}`) }
  return { status: 'success', input: parsed.data, report: eventCostReportSchema.parse(data) }
}
export async function saveEventCost(_state: ActionState, form: FormData): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const parsed = eventCostSaveSchema.safeParse(eventCostFormValues(form))
  if (!parsed.success) return invalidState('validation')
  const db = await createClient()
  const { data, error } = await db.rpc('event_purchase_cost_save', {
    ...args(guard.organizationId, parsed.data),
    p_request_id: parsed.data.request_id,
    p_fingerprint: parsed.data.fingerprint,
  })
  if (error?.code === 'MQ409')
    return { status: 'error', message: (await getTranslations('EventCosts'))('changed') }
  if (error) return rpcErrorState(error)
  revalidatePath('/replenishment/events/costs')
  redirect(`/replenishment/events/costs/${data}`)
}
