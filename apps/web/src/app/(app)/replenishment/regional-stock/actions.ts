'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import type { ActionState } from '@/lib/forms'
import {
  regionalStockInputSchema,
  regionalStockReportSchema,
  REGIONAL_INPUT_BYTES,
  type RegionalStockInput,
  type RegionalStockReport,
} from '@/lib/regional-stock'

export type RegionalStockPreviewState = ActionState & {
  input?: RegionalStockInput
  report?: RegionalStockReport
}
function parseInput(form: FormData) {
  const raw = form.get('input')
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > REGIONAL_INPUT_BYTES)
    return null
  try {
    return regionalStockInputSchema.safeParse(JSON.parse(raw))
  } catch {
    return null
  }
}
async function regionalStockError(error: { code?: string }) {
  if (error.code === 'MQ409' || error.code === 'MQ422') {
    const t = await getTranslations('RegionalStock')
    return { status: 'error' as const, message: t(error.code === 'MQ409' ? 'changed' : 'invalid') }
  }
  return rpcErrorState(error)
}
export async function previewRegionalStock(
  _state: RegionalStockPreviewState,
  form: FormData,
): Promise<RegionalStockPreviewState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const parsed = parseInput(form)
  if (!parsed?.success)
    return {
      status: 'error',
      message: (await getTranslations('RegionalStock'))('invalid'),
    }
  const db = await createClient()
  const { data, error } = await db.rpc('regional_stock_preview', {
    p_organization_id: guard.organizationId,
    p_input: parsed.data,
  })
  if (error) return regionalStockError(error)
  return {
    status: 'success',
    input: parsed.data,
    report: regionalStockReportSchema.parse(data),
  }
}
export async function saveRegionalStock(_state: ActionState, form: FormData): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const parsed = parseInput(form)
  const key = z
    .object({ request: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) })
    .safeParse({ request: form.get('request_id'), fingerprint: form.get('fingerprint') })
  if (!parsed?.success || !parsed.data.confirmed || !key.success) return invalidState('validation')
  const db = await createClient()
  const { data, error } = await db.rpc('regional_stock_save', {
    p_organization_id: guard.organizationId,
    p_input: parsed.data,
    p_request_id: key.data.request,
    p_fingerprint: key.data.fingerprint,
  })
  if (error) return regionalStockError(error)
  revalidatePath('/replenishment/regional-stock')
  redirect(`/replenishment/regional-stock/${data}`)
}
