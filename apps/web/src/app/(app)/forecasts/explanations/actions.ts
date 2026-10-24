'use server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getLocale, getTranslations } from 'next-intl/server'
import {
  requireEditor,
  requireActiveOrganization,
  invalidState,
  rpcErrorState,
} from '@/lib/organizations/guard'
import { isAdminRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'
import { forecastExplanationRequestSchema } from '@/lib/forecast-explainer'
import { explanationRequestSchema, explanationPath } from '@/lib/policy-explainer'
import { policyExplainerConfiguration } from '@/lib/claude-policy.server'
import { generatePolicyExplanation } from '@/lib/policy-explainer.server'
import { checkboxValue, fieldValues, type ActionState } from '@/lib/forms'
export async function explainPolicy(_state: ActionState, form: FormData): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const t = await getTranslations('PolicyExplainer')
  const values = fieldValues(form, ['policy_id', 'request_id', 'fingerprint', 'question'])
  const parsed = explanationRequestSchema.safeParse({
    ...values,
    confirmed: checkboxValue(form, 'confirmed'),
  })
  if (!parsed.success) return { status: 'error', message: t('invalid'), values }
  const config = policyExplainerConfiguration()
  if (!config) return { status: 'error', message: t('unconfigured'), values }
  const db = await createClient()
  const { data, error } = await db.rpc('policy_explainer_request', {
    p_organization_id: guard.organizationId,
    p_policy_id: parsed.data.policy_id,
    p_request_id: parsed.data.request_id,
    p_question: parsed.data.question,
    p_fingerprint: parsed.data.fingerprint,
    p_confirmed: true,
    p_locale: (await getLocale()).startsWith('ar') ? 'ar' : 'en',
  })
  if (error)
    return {
      ...(error.code === 'MQ429'
        ? { status: 'error' as const, message: t('quota') }
        : await rpcErrorState(error)),
      values,
    }
  try {
    await generatePolicyExplanation(data, guard.context.userId, config)
  } catch {
    return { status: 'error', message: t('generationUnavailable'), values }
  }
  revalidatePath(explanationPath)
  redirect(`${explanationPath}/${data}`)
}
export async function explainForecast(_state: ActionState, form: FormData): Promise<ActionState> {
  const guard = await requireEditor(form)
  if (!guard.ok) return guard.state
  const t = await getTranslations('PolicyExplainer')
  const values = fieldValues(form, ['forecast_id', 'request_id', 'fingerprint', 'question'])
  const parsed = forecastExplanationRequestSchema.safeParse({
    ...values,
    confirmed: checkboxValue(form, 'confirmed'),
  })
  if (!parsed.success) return { status: 'error', message: t('invalid'), values }
  const config = policyExplainerConfiguration()
  if (!config) return { status: 'error', message: t('unconfigured'), values }
  const db = await createClient()
  const { data, error } = await db.rpc('forecast_explainer_request', {
    p_organization_id: guard.organizationId,
    p_forecast_id: parsed.data.forecast_id,
    p_request_id: parsed.data.request_id,
    p_question: parsed.data.question,
    p_fingerprint: parsed.data.fingerprint,
    p_confirmed: true,
    p_locale: (await getLocale()).startsWith('ar') ? 'ar' : 'en',
  })
  if (error)
    return {
      ...(error.code === 'MQ429'
        ? { status: 'error' as const, message: t('quota') }
        : await rpcErrorState(error)),
      values,
    }
  try {
    await generatePolicyExplanation(data, guard.context.userId, config)
  } catch {
    return { status: 'error', message: t('generationUnavailable'), values }
  }
  revalidatePath(explanationPath)
  redirect(`${explanationPath}/${data}`)
}
export async function configurePolicyExplainer(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const guard = await requireActiveOrganization(form)
  if (!guard.ok) return guard.state
  if (!isAdminRole(guard.context.role)) return rpcErrorState({ code: 'MQ403' })
  if (form.get('enabled') !== 'on' && form.get('enabled') !== null)
    return invalidState('validation')
  const enabled = checkboxValue(form, 'enabled')
  const t = await getTranslations('PolicyExplainer')
  if (enabled && !policyExplainerConfiguration())
    return { status: 'error', message: t('unconfigured') }
  const db = await createClient()
  const { error } = await db.rpc('policy_explainer_configure', {
    p_organization_id: guard.organizationId,
    p_enabled: enabled,
  })
  if (error) return rpcErrorState(error)
  revalidatePath('/settings')
  return { status: 'success', message: t(enabled ? 'enabledSaved' : 'disabledSaved') }
}
