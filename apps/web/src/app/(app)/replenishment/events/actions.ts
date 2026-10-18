'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import type { ActionState } from '@/lib/forms'
import {
  eventDraftFormValues,
  eventDraftInputSchema,
  eventDraftSaveSchema,
  eventDraftReportSchema,
  eventDraftStatuses,
  type EventDraftInput,
  type EventDraftReport,
} from '@/lib/event-replenishment'

export type EventDraftPreviewState = ActionState & {
  input?: EventDraftInput
  report?: EventDraftReport
}
function args(org: string, input: EventDraftInput) {
  return {
    p_organization_id: org,
    p_scenario_id: input.scenario_id,
    p_backorders: input.backorders,
    p_orders_confirmed: input.orders_confirmed,
    p_event_uncommitted: input.event_uncommitted,
  }
}
export async function previewEventDraft(
  _state: EventDraftPreviewState,
  form: FormData,
): Promise<EventDraftPreviewState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const parsed = eventDraftInputSchema.safeParse(eventDraftFormValues(form))
  if (!parsed.success) return invalidState('validation')
  const db = await createClient()
  const { data, error } = await db.rpc(
    'event_replenishment_preview',
    args(guard.organizationId, parsed.data),
  )
  if (error) return rpcErrorState(error)
  const status = z.object({ status: z.enum(eventDraftStatuses) }).parse(data).status
  if (status !== 'available') {
    const t = await getTranslations(
      status === 'scenario_changed' || status === 'event_unconfirmed'
        ? 'EventReplenishment'
        : 'Replenishment',
    )
    return { status: 'error', message: t(`statuses.${status}`) }
  }
  return { status: 'success', input: parsed.data, report: eventDraftReportSchema.parse(data) }
}
export async function saveEventDraft(_state: ActionState, form: FormData): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const parsed = eventDraftSaveSchema.safeParse(eventDraftFormValues(form))
  if (!parsed.success) return invalidState('validation')
  const db = await createClient()
  const { data, error } = await db.rpc('event_replenishment_save', {
    ...args(guard.organizationId, parsed.data),
    p_request_id: parsed.data.request_id,
    p_fingerprint: parsed.data.fingerprint,
  })
  if (error?.code === 'MQ409')
    return { status: 'error', message: (await getTranslations('EventReplenishment'))('changed') }
  if (error) return rpcErrorState(error)
  revalidatePath('/replenishment/events')
  redirect(`/replenishment/events/${data}`)
}
