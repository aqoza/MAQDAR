import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { siteOrigin } from '@/lib/auth/origin'
import { safeDestination } from '@/lib/auth/redirects'
import { requireClaims } from '@/lib/auth/session'
import { SetPasswordForm } from './set-password-form'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Auth.setPassword')
  return { title: t('title') }
}

/**
 * Shown right after an invitation is accepted. It lives under /auth so the proxy lets the request
 * through; requireClaims() sends anonymous visitors to /login. `next` is where the invitation
 * wanted to land (a path, or an absolute URL on this site).
 */
export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  await requireClaims()
  const t = await getTranslations('Auth.setPassword')
  const { next } = await searchParams
  const destination = safeDestination(next, await siteOrigin())

  return (
    <main className="bg-muted/40 flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground text-sm">{t('description')}</p>
        </CardHeader>
        <CardContent>
          <SetPasswordForm next={destination} />
        </CardContent>
      </Card>
    </main>
  )
}
