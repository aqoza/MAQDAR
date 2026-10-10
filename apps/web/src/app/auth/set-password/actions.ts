'use server'

import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { siteOrigin } from '@/lib/auth/origin'
import { safeDestination } from '@/lib/auth/redirects'
import { requireClaims } from '@/lib/auth/session'
import type { ActionState } from '@/lib/forms'
import { createClient } from '@/lib/supabase/server'

/** Mirrors [auth] minimum_password_length in supabase/config.toml; GoTrue re-checks on update. */
const MIN_PASSWORD_LENGTH = 8

const passwordSchema = z.string().min(MIN_PASSWORD_LENGTH)

/** Form action: `password` plus a hidden `next`. Sets the signed-in user's password, then continues. */
export async function setPassword(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireClaims()
  const t = await getTranslations('Auth')
  const nextField = formData.get('next')
  const next = safeDestination(typeof nextField === 'string' ? nextField : null, await siteOrigin())

  const parsed = passwordSchema.safeParse(formData.get('password'))
  if (!parsed.success) {
    return {
      status: 'error',
      fieldErrors: { password: t('errors.passwordTooShort') },
      code: 'password_too_short',
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password: parsed.data })
  if (error) {
    // The only policy configured is the minimum length, so a weak password is a short one.
    if (error.code === 'weak_password') {
      return {
        status: 'error',
        fieldErrors: { password: t('errors.passwordTooShort') },
        code: error.code,
      }
    }
    const key =
      error.status === 429 || error.code === 'over_request_rate_limit' ? 'rateLimited' : 'generic'
    return { status: 'error', message: t(`errors.${key}`), code: error.code ?? key }
  }

  redirect(next)
}
