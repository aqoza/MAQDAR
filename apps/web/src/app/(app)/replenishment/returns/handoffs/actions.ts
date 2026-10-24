'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import { type ActionState } from '@/lib/forms'
import { dealerReturnsPath } from '@/lib/dealer-returns'
import { returnHandoffsPath } from '@/lib/dealer-return-handoffs'

export async function createReturnHandoff(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const id = z.guid().safeParse(form.get('return_id'))
  if (!id.success) return invalidState('validation')
  const db = await createClient()
  const { data, error } = await db.rpc('dealer_return_handoff_create', {
    p_organization_id: guard.organizationId,
    p_return_id: id.data,
  })
  if (error?.code === 'MQ409') {
    const t = await getTranslations('DealerReturnHandoffs')
    return { status: 'error', code: 'MQ409', message: t('unavailable') }
  }
  if (error) return rpcErrorState(error)
  revalidatePath(dealerReturnsPath + '/' + id.data)
  revalidatePath(returnHandoffsPath)
  redirect(returnHandoffsPath + '/' + data)
}
