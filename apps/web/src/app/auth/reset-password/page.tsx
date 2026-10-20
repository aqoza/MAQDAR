import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { requireClaims } from '@/lib/auth/session'
import { AuthShell } from '../../(auth)/login/auth-shell'
import { ResetPasswordForm } from '../forgot-password/recovery-forms'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Auth.recovery')
  return { title: t('newTitle') }
}

export default async function ResetPasswordPage() {
  await requireClaims()
  const t = await getTranslations('Auth.recovery')
  return (
    <AuthShell title={t('newTitle')} description={t('newDescription')}>
      <ResetPasswordForm />
    </AuthShell>
  )
}
