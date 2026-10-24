'use server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import { type ActionState } from '@/lib/forms'
import {
  batchInputSchema,
  returnBatchErrorKey,
  returnBatchesPath,
} from '@/lib/dealer-return-batches'

export async function createReturnBatch(_state: ActionState, form: FormData): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const parsed = batchInputSchema.safeParse(form.getAll('handoff'))
  if (!parsed.success) return invalidState('validation')
  const db = await createClient()
  const { data, error } = await db.rpc('dealer_return_batch_create', {
    p_organization_id: guard.organizationId,
    p_handoff_ids: parsed.data,
  })
  if (error) {
    if (!['MQ422', 'MQ409', 'MQ404'].includes(error.code)) return rpcErrorState(error)
    const t = await getTranslations('DealerReturnBatches')
    return { status: 'error', code: error.code, message: t(returnBatchErrorKey(error.hint)) }
  }
  revalidatePath(returnBatchesPath)
  redirect(returnBatchesPath + '/' + data)
}
