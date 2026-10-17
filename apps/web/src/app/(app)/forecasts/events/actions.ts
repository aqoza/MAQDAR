'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import type { ActionState } from '@/lib/forms'
import {
  eventFormValues,
  eventInputSchema,
  eventSaveSchema,
  eventReportSchema,
  type EventInput,
  type EventReport,
} from '@/lib/planned-events'

export type EventPreviewState = ActionState & { report?: EventReport; input?: EventInput }
function args(org: string, input: EventInput) {
  return {
    p_organization_id: org,
    p_forecast_id: input.forecast_id,
    p_type: input.event_type,
    p_name: input.name,
    p_reason: input.reason,
    p_unit: input.unit,
    p_additions: input.additions,
    p_confirmed: input.confirmed,
  }
}
export async function previewEvent(
  _state: EventPreviewState,
  form: FormData,
): Promise<EventPreviewState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const parsed = eventInputSchema.safeParse(eventFormValues(form))
  if (!parsed.success) return invalidState('validation')
  const db = await createClient()
  const { data, error } = await db.rpc(
    'planned_event_preview',
    args(guard.organizationId, parsed.data),
  )
  if (error) return rpcErrorState(error)
  return { status: 'success', input: parsed.data, report: eventReportSchema.parse(data) }
}
export async function saveEvent(_state: ActionState, form: FormData): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const parsed = eventSaveSchema.safeParse(eventFormValues(form))
  if (!parsed.success || !parsed.data.confirmed) return invalidState('validation')
  const db = await createClient()
  const { data, error } = await db.rpc('planned_event_save', {
    ...args(guard.organizationId, parsed.data),
    p_request_id: parsed.data.request_id,
    p_fingerprint: parsed.data.fingerprint,
  })
  if (error?.code === 'MQ409')
    return { status: 'error', message: (await getTranslations('PlannedEvents'))('changed') }
  if (error) return rpcErrorState(error)
  revalidatePath('/forecasts/events')
  redirect(`/forecasts/events/${data}`)
}
