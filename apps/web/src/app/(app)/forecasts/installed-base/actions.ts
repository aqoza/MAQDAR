'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import type { ActionState } from '@/lib/forms'
import {
  populationInputSchema,
  populationReportSchema,
  POPULATION_FILE_BYTES,
  type PopulationInput,
  type PopulationReport,
} from '@/lib/installed-base'

export type PopulationPreviewState = ActionState & {
  input?: PopulationInput
  report?: PopulationReport
}
function parseInput(form: FormData) {
  const raw = form.get('input')
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > POPULATION_FILE_BYTES)
    return null
  try {
    return populationInputSchema.safeParse(JSON.parse(raw))
  } catch {
    return null
  }
}
async function populationError(error: { code?: string }) {
  if (error.code === 'MQ409' || error.code === 'MQ422') {
    const t = await getTranslations('InstalledBase')
    return { status: 'error' as const, message: t(error.code === 'MQ409' ? 'changed' : 'invalid') }
  }
  return rpcErrorState(error)
}
export async function previewPopulation(
  _state: PopulationPreviewState,
  form: FormData,
): Promise<PopulationPreviewState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const parsed = parseInput(form)
  if (!parsed?.success)
    return { status: 'error', message: (await getTranslations('InstalledBase'))('invalid') }
  const db = await createClient()
  const { data, error } = await db.rpc('installed_base_preview', {
    p_organization_id: guard.organizationId,
    p_input: parsed.data,
  })
  if (error) return populationError(error)
  return { status: 'success', input: parsed.data, report: populationReportSchema.parse(data) }
}
export async function savePopulation(_state: ActionState, form: FormData): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const parsed = parseInput(form)
  const key = z
    .object({ request: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) })
    .safeParse({ request: form.get('request_id'), fingerprint: form.get('fingerprint') })
  if (!parsed?.success || !parsed.data.confirmed || !parsed.data.non_overlapping || !key.success)
    return invalidState('validation')
  const db = await createClient()
  const { data, error } = await db.rpc('installed_base_save', {
    p_organization_id: guard.organizationId,
    p_input: parsed.data,
    p_request_id: key.data.request,
    p_fingerprint: key.data.fingerprint,
  })
  if (error) return populationError(error)
  revalidatePath('/forecasts/installed-base')
  redirect(`/forecasts/installed-base/${data}`)
}
