'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import type { ActionState } from '@/lib/forms'
import {
  installedDemandInputSchema,
  installedDemandReportSchema,
  RATE_FILE_BYTES,
  type InstalledDemandInput,
  type InstalledDemandReport,
} from '@/lib/installed-base-demand'

export type InstalledDemandPreviewState = ActionState & {
  input?: InstalledDemandInput
  report?: InstalledDemandReport
}
function parseInput(form: FormData) {
  const raw = form.get('input')
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > RATE_FILE_BYTES) return null
  try {
    return installedDemandInputSchema.safeParse(JSON.parse(raw))
  } catch {
    return null
  }
}
async function installedDemandError(error: { code?: string }) {
  if (error.code === 'MQ409' || error.code === 'MQ422') {
    const t = await getTranslations('InstalledBaseDemand')
    return { status: 'error' as const, message: t(error.code === 'MQ409' ? 'changed' : 'invalid') }
  }
  return rpcErrorState(error)
}
export async function previewInstalledDemand(
  _state: InstalledDemandPreviewState,
  form: FormData,
): Promise<InstalledDemandPreviewState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const parsed = parseInput(form)
  if (!parsed?.success)
    return { status: 'error', message: (await getTranslations('InstalledBaseDemand'))('invalid') }
  const db = await createClient()
  const { data, error } = await db.rpc('installed_base_demand_preview', {
    p_organization_id: guard.organizationId,
    p_input: parsed.data,
  })
  if (error) return installedDemandError(error)
  return { status: 'success', input: parsed.data, report: installedDemandReportSchema.parse(data) }
}
export async function saveInstalledDemand(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const parsed = parseInput(form)
  const key = z
    .object({ request: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) })
    .safeParse({ request: form.get('request_id'), fingerprint: form.get('fingerprint') })
  if (!parsed?.success || !parsed.data.confirmed || !key.success) return invalidState('validation')
  const db = await createClient()
  const { data, error } = await db.rpc('installed_base_demand_save', {
    p_organization_id: guard.organizationId,
    p_input: parsed.data,
    p_request_id: key.data.request,
    p_fingerprint: key.data.fingerprint,
  })
  if (error) return installedDemandError(error)
  revalidatePath('/forecasts/installed-base/demand')
  redirect(`/forecasts/installed-base/demand/${data}`)
}
