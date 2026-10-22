'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import type { ActionState } from '@/lib/forms'
import {
  stockRegionInputSchema,
  stockRegionReportSchema,
  STOCK_REGION_INPUT_BYTES,
  type StockRegionInput,
  type StockRegionReport,
} from '@/lib/stock-regions'

export type StockRegionPreviewState = ActionState & {
  input?: StockRegionInput
  report?: StockRegionReport
}
function parseInput(form: FormData) {
  const raw = form.get('input')
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > STOCK_REGION_INPUT_BYTES)
    return null
  try {
    return stockRegionInputSchema.safeParse(JSON.parse(raw))
  } catch {
    return null
  }
}
async function stockRegionError(error: { code?: string }) {
  if (error.code === 'MQ409' || error.code === 'MQ422') {
    const t = await getTranslations('StockRegion')
    return { status: 'error' as const, message: t(error.code === 'MQ409' ? 'changed' : 'invalid') }
  }
  return rpcErrorState(error)
}
export async function previewStockRegion(
  _state: StockRegionPreviewState,
  form: FormData,
): Promise<StockRegionPreviewState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const parsed = parseInput(form)
  if (!parsed?.success)
    return {
      status: 'error',
      message: (await getTranslations('StockRegion'))('invalid'),
    }
  const db = await createClient()
  const { data, error } = await db.rpc('stock_region_preview', {
    p_organization_id: guard.organizationId,
    p_input: parsed.data,
  })
  if (error) return stockRegionError(error)
  return {
    status: 'success',
    input: parsed.data,
    report: stockRegionReportSchema.parse(data),
  }
}
export async function saveStockRegion(_state: ActionState, form: FormData): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const parsed = parseInput(form)
  const key = z
    .object({ request: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) })
    .safeParse({ request: form.get('request_id'), fingerprint: form.get('fingerprint') })
  if (!parsed?.success || !parsed.data.confirmed || !key.success) return invalidState('validation')
  const db = await createClient()
  const { data, error } = await db.rpc('stock_region_save', {
    p_organization_id: guard.organizationId,
    p_input: parsed.data,
    p_request_id: key.data.request,
    p_fingerprint: key.data.fingerprint,
  })
  if (error) return stockRegionError(error)
  revalidatePath('/replenishment/regional-stock/regions')
  redirect(`/replenishment/regional-stock/regions/${data}`)
}

export async function archiveStockRegion(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const region = z.guid().safeParse(form.get('region_id'))
  if (!region.success) return invalidState('validation')
  const db = await createClient()
  const { error } = await db.rpc('stock_region_archive', {
    p_organization_id: guard.organizationId,
    p_region_id: region.data,
  })
  if (error) return rpcErrorState(error)
  revalidatePath('/replenishment/regional-stock/regions')
  revalidatePath(`/replenishment/regional-stock/regions/${region.data}`)
  revalidatePath('/replenishment/regional-stock/new')
  redirect(`/replenishment/regional-stock/regions/${region.data}`)
}
