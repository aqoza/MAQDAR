'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { deliveryScenarioStatuses } from '@/lib/delivery-scenarios'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import type { ActionState } from '@/lib/forms'
import {
  eventDeliveryFormValues,
  eventDeliveryInputSchema,
  eventDeliverySaveSchema,
  eventDeliveryReportSchema,
  type EventDeliveryInput,
  type EventDeliveryReport,
} from '@/lib/event-deliveries'

export type EventDeliveryPreviewState = ActionState & {
  input?: EventDeliveryInput
  report?: EventDeliveryReport
}
function args(org: string, input: EventDeliveryInput) {
  return {
    p_organization_id: org,
    p_scenario_id: input.scenario_id,
    p_requested_date: input.requested_date,
    p_calendars_confirmed: input.calendars_confirmed,
  }
}
export async function previewEventDelivery(
  _state: EventDeliveryPreviewState,
  form: FormData,
): Promise<EventDeliveryPreviewState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const parsed = eventDeliveryInputSchema.safeParse(eventDeliveryFormValues(form))
  if (!parsed.success) return invalidState('validation')
  const db = await createClient()
  const { data, error } = await db.rpc(
    'event_delivery_preview',
    args(guard.organizationId, parsed.data),
  )
  if (error) return rpcErrorState(error)
  const status = z.object({ status: z.enum(deliveryScenarioStatuses) }).parse(data).status
  if (status === 'source_unavailable')
    return {
      status: 'error',
      message: (await getTranslations('EventDeliveries'))(`statuses.${status}`),
    }
  return { status: 'success', input: parsed.data, report: eventDeliveryReportSchema.parse(data) }
}
export async function saveEventDelivery(_state: ActionState, form: FormData): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const parsed = eventDeliverySaveSchema.safeParse(eventDeliveryFormValues(form))
  if (!parsed.success) return invalidState('validation')
  const db = await createClient()
  const { data, error } = await db.rpc('event_delivery_save', {
    ...args(guard.organizationId, parsed.data),
    p_request_id: parsed.data.request_id,
    p_fingerprint: parsed.data.fingerprint,
  })
  if (error?.code === 'MQ409')
    return { status: 'error', message: (await getTranslations('EventDeliveries'))('changed') }
  if (error) return rpcErrorState(error)
  revalidatePath('/replenishment/events/deliveries')
  redirect(`/replenishment/events/deliveries/${data}`)
}
