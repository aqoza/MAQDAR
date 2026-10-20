import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AuthShell } from './auth-shell'
import { LoginForm } from './login-form'

const ERROR_KEYS = { link: 'linkInvalid', inviteExpired: 'inviteExpired' } as const

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Auth')
  return { title: t('title') }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const t = await getTranslations('Auth')
  const { error } = await searchParams
  const errorKey =
    error && Object.hasOwn(ERROR_KEYS, error) ? ERROR_KEYS[error as keyof typeof ERROR_KEYS] : null
  return (
    <AuthShell title={t('title')} description={t('design.formDescription')}>
      {errorKey ? (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{t(`errors.${errorKey}`)}</AlertDescription>
        </Alert>
      ) : null}
      <LoginForm />
    </AuthShell>
  )
}
