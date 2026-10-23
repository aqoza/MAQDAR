'use server'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { createClient as anonymousClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireActiveOrganization, invalidState, rpcErrorState } from '@/lib/organizations/guard'
import { env } from '@/lib/env'
import { siteOrigin } from '@/lib/auth/origin'
import { emailReturnPath } from '@/lib/auth/email-destination'
import { fieldValues, type ActionState } from '@/lib/forms'
export async function inviteSupplier(_state: ActionState, form: FormData): Promise<ActionState> {
  const guard = await requireActiveOrganization(form)
  if (!guard.ok) return guard.state
  if (!['owner', 'admin'].includes(guard.context.role ?? ''))
    return rpcErrorState({ code: 'MQ403' })
  const values = fieldValues(form, ['supplier_code', 'email'])
  const input = z
    .object({ supplier_code: z.string().min(1).max(64), email: z.email().max(254) })
    .safeParse(values)
  if (!input.success) return { ...(await invalidState('validation')), values }
  const db = await createClient()
  const supplier = await db
    .from('suppliers')
    .select('id')
    .eq('organization_id', guard.organizationId)
    .eq('code', input.data.supplier_code)
    .eq('is_active', true)
    .maybeSingle()
  if (supplier.error || !supplier.data)
    return { ...(await rpcErrorState(supplier.error ?? { code: 'MQ404' })), values }
  const result = await db.rpc('supplier_portal_invite', {
    p_organization_id: guard.organizationId,
    p_supplier_id: supplier.data.id,
    p_email: input.data.email,
  })
  if (result.error) return { ...(await rpcErrorState(result.error)), values }
  const invitation = z
    .object({ id: z.guid(), email: z.email(), send: z.boolean() })
    .parse(result.data)
  revalidatePath('/suppliers/portal-access')
  const t = await getTranslations('SupplierPortal')
  if (!invitation.send) return { status: 'success', message: t('alreadyGranted') }
  const redirectTo = `${await siteOrigin()}${emailReturnPath(`/supplier-portal/${invitation.id}`)}`
  const { error } = await createAdminClient().auth.admin.inviteUserByEmail(invitation.email, {
    redirectTo,
  })
  if (error && error.code !== 'email_exists')
    return { status: 'error', message: t('emailFailed'), code: 'email_failed', values }
  if (error) {
    const anonymous = anonymousClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    )
    const sent = await anonymous.auth.signInWithOtp({
      email: invitation.email,
      options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
    })
    if (sent.error)
      return { status: 'error', message: t('emailFailed'), code: 'email_failed', values }
  }
  return { status: 'success', message: t('sent') }
}
export async function revokeSupplier(_state: ActionState, form: FormData): Promise<ActionState> {
  const guard = await requireActiveOrganization(form)
  if (!guard.ok) return guard.state
  const id = z.guid().safeParse(form.get('grant_id'))
  if (!id.success) return invalidState('validation')
  const db = await createClient()
  const { error } = await db.rpc('supplier_portal_revoke', {
    p_organization_id: guard.organizationId,
    p_grant_id: id.data,
  })
  if (error) return rpcErrorState(error)
  revalidatePath('/suppliers/portal-access')
  revalidatePath('/supplier-portal', 'layout')
  return { status: 'success', message: (await getTranslations('SupplierPortal'))('revoked') }
}
