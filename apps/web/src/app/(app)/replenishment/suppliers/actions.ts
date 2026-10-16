'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { fieldValues, type ActionState } from '@/lib/forms'
import { requireEditor, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import { supplierScenarioSaveSchema } from '@/lib/supplier-scenarios'

export async function saveSupplierScenario(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const values = fieldValues(form, ['draft', 'supplier', 'confirmed', 'request_id', 'fingerprint'])
  const parsed = supplierScenarioSaveSchema.safeParse(values)
  if (!parsed.success) return { ...(await invalidState('validation')), values }
  const db = await createClient()
  const v = parsed.data
  const { data, error } = await db.rpc('supplier_scenario_save', {
    p_organization_id: guard.organizationId,
    p_draft_id: v.draft,
    p_supplier_code: v.supplier,
    p_terms_confirmed: v.confirmed === 'true',
    p_request_id: v.request_id,
    p_fingerprint: v.fingerprint,
  })
  if (error?.code === 'MQ409') {
    const t = await getTranslations('SupplierScenarios')
    return { status: 'error', message: t('changed'), values }
  }
  if (error) return { ...(await rpcErrorState(error)), values }
  revalidatePath(`/replenishment/${v.draft}`)
  redirect(`/replenishment/suppliers/${data}`)
}
