'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import {
  requireEditor,
  requireActiveOrganization,
  invalidState,
  rpcErrorState,
} from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import { fieldValues, checkboxValue, type ActionState } from '@/lib/forms'
import {
  dealerReturnInputSchema,
  dealerReturnsPath,
  returnFields,
  returnReasonSchema,
} from '@/lib/dealer-returns'

export async function saveDealerReturn(_state: ActionState, form: FormData): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const values = fieldValues(form, returnFields)
  const parsed = dealerReturnInputSchema.safeParse({
    ...values,
    confirmed: checkboxValue(form, 'confirmed'),
  })
  const request = z.uuid().safeParse(form.get('request_id'))
  if (!request.success) return invalidState('validation')
  if (!parsed.success) {
    const t = await getTranslations('DealerReturns')
    return {
      status: 'error',
      values,
      message: t('invalid'),
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [String(i.path[0]), t('invalidField')]),
      ),
    }
  }
  const db = await createClient()
  const { data, error } = await db.rpc('dealer_return_save', {
    p_organization_id: guard.organizationId,
    p_input: parsed.data,
    p_request_id: request.data,
  })
  if (error) return { ...(await rpcErrorState(error)), values }
  revalidatePath(dealerReturnsPath)
  redirect(`${dealerReturnsPath}/${data}`)
}
export async function withdrawDealerReturn(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const guard = await requireActiveOrganization(form)
  if (!guard.ok) return guard.state
  const id = z.guid().safeParse(form.get('return_id'))
  const reason = returnReasonSchema.safeParse(form.get('reason'))
  if (!id.success || !reason.success) return invalidState('validation')
  const db = await createClient()
  const { error } = await db.rpc('dealer_return_withdraw', {
    p_organization_id: guard.organizationId,
    p_return_id: id.data,
    p_reason: reason.data,
  })
  if (error) return rpcErrorState(error)
  revalidatePath(dealerReturnsPath)
  redirect(`${dealerReturnsPath}/${id.data}`)
}
