'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import type { ActionState } from '@/lib/forms'
import {
  regionalSourcingInputSchema,
  regionalSourcingReportSchema,
  SOURCING_INPUT_BYTES,
  regionalSourcingPath,
  type RegionalSourcingInput,
  type RegionalSourcingReport,
  type SourcingChoices,
} from '@/lib/regional-sourcing'
import { sourcingContext, sourcingChoices } from '@/lib/regional-sourcing.server'

export type SourcingPreviewState = ActionState & {
  input?: RegionalSourcingInput
  report?: RegionalSourcingReport
}
export type SourcingOptionsState = ActionState & { choices?: SourcingChoices }
function parseInput(form: FormData) {
  const raw = form.get('input')
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > SOURCING_INPUT_BYTES)
    return null
  try {
    return regionalSourcingInputSchema.safeParse(JSON.parse(raw))
  } catch {
    return null
  }
}
async function sourcingError(error: { code?: string }) {
  if (error.code === 'MQ409' || error.code === 'MQ422') {
    const t = await getTranslations('RegionalSourcing')
    return { status: 'error' as const, message: t(error.code === 'MQ409' ? 'changed' : 'invalid') }
  }
  return rpcErrorState(error)
}
export async function previewRegionalSourcing(
  _state: SourcingPreviewState,
  form: FormData,
): Promise<SourcingPreviewState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const parsed = parseInput(form)
  if (!parsed?.success) return invalidState('validation')
  const db = await createClient()
  const { data, error } = await db.rpc('regional_sourcing_preview', {
    p_organization_id: guard.organizationId,
    p_input: parsed.data,
  })
  if (error) return sourcingError(error)
  return { status: 'success', input: parsed.data, report: regionalSourcingReportSchema.parse(data) }
}
export async function saveRegionalSourcing(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const parsed = parseInput(form)
  const key = z
    .object({ request: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) })
    .safeParse({ request: form.get('request_id'), fingerprint: form.get('fingerprint') })
  if (!parsed?.success || !key.success) return invalidState('validation')
  const db = await createClient()
  const { data, error } = await db.rpc('regional_sourcing_save', {
    p_organization_id: guard.organizationId,
    p_input: parsed.data,
    p_request_id: key.data.request,
    p_fingerprint: key.data.fingerprint,
  })
  if (error) return sourcingError(error)
  revalidatePath(regionalSourcingPath)
  redirect(`${regionalSourcingPath}/${data}`)
}
export async function loadSourcingOptions(
  _state: SourcingOptionsState,
  form: FormData,
): Promise<SourcingOptionsState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const parsed = z
    .object({
      region: z.guid(),
      draft: z.guid(),
      location: z.guid(),
      policy: z.union([z.literal(''), z.guid()]),
      page: z.coerce.number().int().min(1).max(100000),
      revisionPage: z.coerce.number().int().min(1).max(100000),
    })
    .safeParse(
      Object.fromEntries(
        ['region', 'draft', 'location', 'policy', 'page', 'revisionPage'].map((key) => [
          key,
          form.get(key),
        ]),
      ),
    )
  if (!parsed.success) return invalidState('validation')
  const v = parsed.data
  const context = await sourcingContext(guard.organizationId, v.region, v.draft)
  if (!context) return rpcErrorState({ code: 'MQ404' })
  const choices = await sourcingChoices(
    guard.organizationId,
    context,
    v.location,
    v.page,
    v.policy,
    v.revisionPage,
  )
  if (!choices) return rpcErrorState({ code: 'MQ404' })
  return { status: 'success', choices }
}
