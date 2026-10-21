'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import type { ActionState } from '@/lib/forms'
import {
  installedEvaluationInputSchema,
  installedEvaluationReportSchema,
  EVALUATION_INPUT_BYTES,
  type InstalledEvaluationInput,
  type InstalledEvaluationReport,
} from '@/lib/installed-base-evaluation'

export type InstalledEvaluationPreviewState = ActionState & {
  input?: InstalledEvaluationInput
  report?: InstalledEvaluationReport
}
function parseInput(form: FormData) {
  const raw = form.get('input')
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > EVALUATION_INPUT_BYTES)
    return null
  try {
    return installedEvaluationInputSchema.safeParse(JSON.parse(raw))
  } catch {
    return null
  }
}
async function installedEvaluationError(error: { code?: string }) {
  if (error.code === 'MQ409' || error.code === 'MQ422') {
    const t = await getTranslations('InstalledBaseEvaluation')
    return { status: 'error' as const, message: t(error.code === 'MQ409' ? 'changed' : 'invalid') }
  }
  return rpcErrorState(error)
}
export async function previewInstalledEvaluation(
  _state: InstalledEvaluationPreviewState,
  form: FormData,
): Promise<InstalledEvaluationPreviewState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const parsed = parseInput(form)
  if (!parsed?.success)
    return {
      status: 'error',
      message: (await getTranslations('InstalledBaseEvaluation'))('invalid'),
    }
  const db = await createClient()
  const { data, error } = await db.rpc('installed_base_evaluation_preview', {
    p_organization_id: guard.organizationId,
    p_input: parsed.data,
  })
  if (error) return installedEvaluationError(error)
  return {
    status: 'success',
    input: parsed.data,
    report: installedEvaluationReportSchema.parse(data),
  }
}
export async function saveInstalledEvaluation(
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
  const { data, error } = await db.rpc('installed_base_evaluation_save', {
    p_organization_id: guard.organizationId,
    p_input: parsed.data,
    p_request_id: key.data.request,
    p_fingerprint: key.data.fingerprint,
  })
  if (error) return installedEvaluationError(error)
  revalidatePath('/forecasts/installed-base/evaluations')
  redirect(`/forecasts/installed-base/evaluations/${data}`)
}
