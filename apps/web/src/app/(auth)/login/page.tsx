import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { LoginForm } from './login-form'

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

  return (
    <main className="bg-muted/40 flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error === 'link' ? (
            <p role="alert" className="text-destructive text-sm">
              {t('errors.linkInvalid')}
            </p>
          ) : null}
          <LoginForm />
        </CardContent>
      </Card>
    </main>
  )
}
