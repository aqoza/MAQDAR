import { LogOut } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Button } from '@/components/ui/button'
import { signOut } from '@/lib/auth/actions'
import { requireClaims } from '@/lib/auth/session'

/**
 * Shell for the pages a signed-in user sees before (or between) organizations: the hub, creating an
 * organization and accepting an invitation. No sidebar, since there is no active tenant to navigate.
 */
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const claims = await requireClaims()
  const t = await getTranslations('Common')
  const email = claims.email ?? ''

  return (
    <div className="bg-muted/40 flex min-h-svh flex-col">
      <header className="bg-background flex h-14 shrink-0 items-center justify-between gap-4 border-b px-6">
        <Link href="/organizations" className="font-semibold tracking-tight">
          {t('appName')}
        </Link>
        <div className="flex min-w-0 items-center gap-3">
          {email ? (
            <p className="text-muted-foreground truncate text-sm" title={email}>
              <span className="sr-only">{t('signedInAs')} </span>
              {email}
            </p>
          ) : null}
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm">
              <LogOut />
              {t('signOut')}
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">{children}</main>
    </div>
  )
}
