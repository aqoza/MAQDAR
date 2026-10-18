'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import type { ActionState } from '@/lib/forms'
import {
  eventSupplierFormValues,
  eventSupplierInputSchema,
  eventSupplierSaveSchema,
  eventSupplierReportSchema,
  eventSupplierStatuses,
  type EventSupplierInput,
  type EventSupplierReport,
} from '@/lib/event-suppliers'

export type EventSupplierPreviewState = ActionState & {
  input?: EventSupplierInput
  report?: EventSupplierReport
}
function args(org: string, input: EventSupplierInput) {
  return {
    p_organization_id: org,
    p_draft_id: input.draft_id,
    p_supplier_code: input.supplier_code,
    p_terms_confirmed: input.terms_confirmed,
  }
}
export async function previewEventSupplier(
  _state: EventSupplierPreviewState,
  form: FormData,
): Promise<EventSupplierPreviewState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const parsed = eventSupplierInputSchema.safeParse(eventSupplierFormValues(form))
  if (!parsed.success) return invalidState('validation')
  const db = await createClient()
  const { data, error } = await db.rpc(
    'event_supplier_preview',
    args(guard.organizationId, parsed.data),
  )
  if (error) return rpcErrorState(error)
  const status = z.object({ status: z.enum(eventSupplierStatuses) }).parse(data).status
  if (status !== 'available')
    return {
      status: 'error',
      message: (await getTranslations('EventSuppliers'))(`statuses.${status}`),
    }
  return { status: 'success', input: parsed.data, report: eventSupplierReportSchema.parse(data) }
}
export async function saveEventSupplier(_state: ActionState, form: FormData): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const parsed = eventSupplierSaveSchema.safeParse(eventSupplierFormValues(form))
  if (!parsed.success) return invalidState('validation')
  const db = await createClient()
  const { data, error } = await db.rpc('event_supplier_save', {
    ...args(guard.organizationId, parsed.data),
    p_request_id: parsed.data.request_id,
    p_fingerprint: parsed.data.fingerprint,
  })
  if (error?.code === 'MQ409')
    return { status: 'error', message: (await getTranslations('EventSuppliers'))('changed') }
  if (error) return rpcErrorState(error)
  revalidatePath('/replenishment/events/suppliers')
  redirect(`/replenishment/events/suppliers/${data}`)
}
