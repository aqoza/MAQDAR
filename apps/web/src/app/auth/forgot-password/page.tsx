import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { AuthShell } from '../../(auth)/login/auth-shell'
import styles from '../../(auth)/login/login.module.css'
import { ForgotPasswordForm } from './recovery-forms'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Auth.recovery')
  return { title: t('title') }
}

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const t = await getTranslations('Auth.recovery')
  const { error } = await searchParams
  return (
    <AuthShell title={t('title')} description={t('description')}>
      {error === 'link' ? (
        <p role="alert" className={styles.error}>
          {t('invalid')}
        </p>
      ) : null}
      <ForgotPasswordForm />
    </AuthShell>
  )
}
