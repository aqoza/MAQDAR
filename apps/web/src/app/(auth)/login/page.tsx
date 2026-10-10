import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { LoginForm } from './login-form'

/** `?error=` values the auth routes redirect with, mapped to Auth.errors keys. */
const ERROR_KEYS = {
  link: 'linkInvalid',
  inviteExpired: 'inviteExpired',
} as const

type ErrorQuery = keyof typeof ERROR_KEYS

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
  const errorKey = error && isErrorQuery(error) ? ERROR_KEYS[error] : null

  return (
    <main className="bg-muted/40 flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {errorKey ? (
            <Alert variant="destructive">
              <AlertDescription>{t(`errors.${errorKey}`)}</AlertDescription>
            </Alert>
          ) : null}
          <LoginForm />
        </CardContent>
      </Card>
    </main>
  )
}

function isErrorQuery(value: string): value is ErrorQuery {
  return Object.hasOwn(ERROR_KEYS, value)
}
