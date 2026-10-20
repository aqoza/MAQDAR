import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { AuthShell } from '../../(auth)/login/auth-shell'
import { RecoveryConfirmationForm } from '../forgot-password/recovery-forms'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Auth.recovery')
  return { title: t('title'), referrer: 'no-referrer' }
}

/** Render only: mail scanners may GET this URL without consuming its one-time credential. */
export default async function RecoverPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; code?: string }>
}) {
  const { token_hash: token, code } = await searchParams
  if ((!token && !code) || (token && code)) redirect('/auth/forgot-password?error=link')
  const t = await getTranslations('Auth.recovery')
  return (
    <AuthShell title={t('title')} description={t('confirmDescription')}>
      <RecoveryConfirmationForm token={token} code={code} />
    </AuthShell>
  )
}
